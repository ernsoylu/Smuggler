"""Click commands for torrent management."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich import box

from cli.aria2_client import Aria2Client, Aria2Error
from cli.docker_client import get_docker_client, get_worker

console = Console()


def _get_aria2(worker_name: str) -> Aria2Client:
    """Resolve a mule name to a live Aria2Client, or raise SystemExit."""
    client = get_docker_client()
    try:
        worker = get_worker(client, worker_name)
    except RuntimeError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise SystemExit(1)

    if worker.status != "running":
        console.print(f"[red]Mule '{worker_name}' is not running (status={worker.status})[/red]")
        raise SystemExit(1)

    return Aria2Client(host="localhost", port=worker.rpc_port, token=worker.rpc_token)


def _format_bytes(value: str | int) -> str:
    n = int(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n //= 1024
    return f"{n:.1f} PB"


def _progress_bar(completed: int, total: int, width: int = 20) -> str:
    if total <= 0:
        return "[" + "-" * width + "]   -%"
    pct = min(completed / total, 1.0)
    filled = int(pct * width)
    bar = "#" * filled + "-" * (width - filled)
    return f"[{bar}] {pct * 100:.1f}%"


@click.group("torrent")
def torrent_group() -> None:
    """Manage torrents on mule containers."""


@torrent_group.command("add")
@click.argument("worker_name")
@click.option("--magnet", "-m", default=None, help="Magnet URI to add.")
@click.option(
    "--file",
    "-f",
    "torrent_file",
    default=None,
    type=click.Path(exists=True, dir_okay=False, readable=True),
    help="Path to a .torrent file.",
)
def torrent_add(worker_name: str, magnet: Optional[str], torrent_file: Optional[str]) -> None:
    """Add a torrent (magnet or .torrent file) to a mule."""
    if not magnet and not torrent_file:
        console.print("[red]Error:[/red] Provide either --magnet or --file.")
        raise SystemExit(1)
    if magnet and torrent_file:
        console.print("[red]Error:[/red] Provide --magnet or --file, not both.")
        raise SystemExit(1)

    aria2 = _get_aria2(worker_name)

    try:
        if magnet:
            gid = aria2.add_magnet(magnet)
            console.print(f"[green]Torrent added[/green] to [bold]{worker_name}[/bold]  GID: {gid}")
        else:
            gid = aria2.add_torrent_file(torrent_file)  # type: ignore[arg-type]
            console.print(
                f"[green]Torrent added[/green] ({Path(torrent_file).name}) "  # type: ignore[arg-type]
                f"to [bold]{worker_name}[/bold]  GID: {gid}"
            )
    except Aria2Error as exc:
        console.print(f"[red]aria2 error:[/red] {exc}")
        raise SystemExit(1)


@torrent_group.command("list")
@click.argument("worker_name", required=False, default=None)
def torrent_list(worker_name: Optional[str]) -> None:
    """List torrents. If WORKER_NAME is omitted, lists across all running mules."""
    docker_client = get_docker_client()

    from cli.docker_client import list_workers

    if worker_name:
        target_workers = [get_worker(docker_client, worker_name)]
    else:
        target_workers = [w for w in list_workers(docker_client) if w.status == "running"]

    if not target_workers:
        console.print("[yellow]No running mules found.[/yellow]")
        return

    table = Table(box=box.ROUNDED, show_header=True, header_style="bold cyan")
    table.add_column("Mule")
    table.add_column("GID")
    table.add_column("Name")
    table.add_column("State")
    table.add_column("Progress")
    table.add_column("Down Speed")
    table.add_column("Size")

    for w in target_workers:
        aria2 = Aria2Client(host="localhost", port=w.rpc_port, token=w.rpc_token)
        try:
            all_downloads = (
                aria2.tell_active()
                + aria2.tell_waiting()
                + aria2.tell_stopped()
            )
        except Aria2Error as exc:
            table.add_row(w.name, "-", f"[red]{exc}[/red]", "-", "-", "-", "-")
            continue

        if not all_downloads:
            table.add_row(w.name, "-", "[dim]no torrents[/dim]", "-", "-", "-", "-")
            continue

        for dl in all_downloads:
            gid = dl.get("gid", "?")
            name = dl.get("bittorrent", {}).get("info", {}).get("name") or dl.get("files", [{}])[0].get("path", "?")
            name = Path(name).name if name else "?"
            state = dl.get("status", "?")
            completed = int(dl.get("completedLength", 0))
            total = int(dl.get("totalLength", 0))
            speed = int(dl.get("downloadSpeed", 0))
            state_style = {
                "active": "green",
                "waiting": "yellow",
                "paused": "blue",
                "error": "red",
                "complete": "dim",
                "removed": "dim",
            }.get(state, "white")

            table.add_row(
                w.name,
                gid,
                name[:40],
                f"[{state_style}]{state}[/{state_style}]",
                _progress_bar(completed, total),
                f"{_format_bytes(speed)}/s",
                _format_bytes(total),
            )

    console.print(table)


@torrent_group.command("remove")
@click.argument("worker_name")
@click.argument("gid")
def torrent_remove(worker_name: str, gid: str) -> None:
    """Remove a torrent (by GID) from a mule."""
    aria2 = _get_aria2(worker_name)
    try:
        aria2.remove(gid)
        console.print(f"[green]Removed[/green] GID {gid} from [bold]{worker_name}[/bold]")
    except Aria2Error as exc:
        console.print(f"[red]aria2 error:[/red] {exc}")
        raise SystemExit(1)


@torrent_group.command("pause")
@click.argument("worker_name")
@click.argument("gid")
def torrent_pause(worker_name: str, gid: str) -> None:
    """Pause a torrent on a mule."""
    aria2 = _get_aria2(worker_name)
    try:
        aria2.pause(gid)
        console.print(f"[yellow]Paused[/yellow] GID {gid} on [bold]{worker_name}[/bold]")
    except Aria2Error as exc:
        console.print(f"[red]aria2 error:[/red] {exc}")
        raise SystemExit(1)


@torrent_group.command("resume")
@click.argument("worker_name")
@click.argument("gid")
def torrent_resume(worker_name: str, gid: str) -> None:
    """Resume a paused torrent on a mule."""
    aria2 = _get_aria2(worker_name)
    try:
        aria2.resume(gid)
        console.print(f"[green]Resumed[/green] GID {gid} on [bold]{worker_name}[/bold]")
    except Aria2Error as exc:
        console.print(f"[red]aria2 error:[/red] {exc}")
        raise SystemExit(1)
