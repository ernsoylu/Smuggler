"""Click commands for worker management."""

from __future__ import annotations

import json
import time
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table
from rich import box

from cli.docker_client import (
    build_image,
    exec_in_worker,
    get_container_logs,
    get_docker_client,
    get_worker,
    kill_all_workers,
    kill_worker,
    list_workers,
    start_worker,
    stop_worker,
    wait_for_vpn,
    WORKER_IMAGE,
)

console = Console()


@click.group("worker")
def worker_group() -> None:
    """Manage download worker containers."""


@worker_group.command("start")
@click.option(
    "--config",
    "-c",
    required=True,
    type=click.Path(exists=True, dir_okay=False, readable=True),
    help="Path to the WireGuard .conf file.",
)
@click.option("--name", "-n", default=None, help="Optional worker name (auto-generated if omitted).")
@click.option(
    "--downloads-dir",
    default=None,
    type=click.Path(file_okay=False),
    help="Host directory for downloads (default: ./downloads).",
)
def worker_start(config: str, name: str | None, downloads_dir: str | None) -> None:
    """Start a new worker container with the given VPN config."""
    client = get_docker_client()

    # ── Step 1: create the container ────────────────────────────────────────
    with console.status(f"Creating worker with [bold]{Path(config).name}[/bold]..."):
        try:
            worker = start_worker(
                client,
                vpn_config_path=config,
                name=name,
                downloads_dir=downloads_dir,
            )
        except RuntimeError as exc:
            console.print(f"[red]Error:[/red] {exc}")
            raise SystemExit(1)

    console.print(f"Container [bold]{worker.name}[/bold] created — waiting for VPN...")

    # ── Step 2: block until WireGuard is up and VPN IP is confirmed ─────────
    with console.status("Confirming WireGuard connection (up to 60s)..."):
        try:
            ip_info = wait_for_vpn(client, worker.name, timeout=60)
        except RuntimeError as exc:
            console.print(f"\n[red]VPN failed to come up — stopping container.[/red]")
            console.print(f"[red]{exc}[/red]")
            try:
                stop_worker(client, worker.name, remove=True)
            except RuntimeError:
                pass
            raise SystemExit(1)

    console.print(f"[green]Worker ready:[/green] [bold]{worker.name}[/bold]")
    console.print(f"  Container ID : {worker.id}")
    console.print(f"  aria2 RPC    : localhost:{worker.rpc_port}")
    console.print(f"  VPN config   : {worker.vpn_config}")
    console.print(f"  External IP  : [cyan]{ip_info.get('ip', '?')}[/cyan]"
                  f"  ([bold]{ip_info.get('country', '?')}[/bold]"
                  f" / {ip_info.get('city', '?')})")


@worker_group.command("list")
def worker_list() -> None:
    """List all dvd workers."""
    client = get_docker_client()
    workers = list_workers(client)

    if not workers:
        console.print("[yellow]No workers found.[/yellow]  Start one with `dvd worker start`.")
        return

    table = Table(box=box.ROUNDED, show_header=True, header_style="bold cyan")
    table.add_column("Name")
    table.add_column("ID")
    table.add_column("Status")
    table.add_column("RPC Port")
    table.add_column("VPN Config")

    for w in workers:
        status_style = "green" if w.status == "running" else "yellow"
        table.add_row(
            w.name,
            w.id,
            f"[{status_style}]{w.status}[/{status_style}]",
            str(w.rpc_port) if w.rpc_port else "-",
            w.vpn_config or "-",
        )

    console.print(table)


@worker_group.command("stop")
@click.argument("worker_name")
@click.option("--keep", is_flag=True, default=False, help="Stop but do not remove the container.")
def worker_stop(worker_name: str, keep: bool) -> None:
    """Stop (and remove) a worker container."""
    client = get_docker_client()
    with console.status(f"Stopping [bold]{worker_name}[/bold]..."):
        try:
            stop_worker(client, worker_name, remove=not keep)
        except RuntimeError as exc:
            console.print(f"[red]Error:[/red] {exc}")
            raise SystemExit(1)
    action = "stopped" if keep else "stopped and removed"
    console.print(f"[green]Worker {action}:[/green] {worker_name}")


@worker_group.command("ip")
@click.argument("worker_name")
@click.option("--wait", default=30, show_default=True, help="Seconds to wait for VPN to be ready.")
def worker_ip(worker_name: str, wait: int) -> None:
    """Display the external IP and geolocation of a worker's VPN connection."""
    client = get_docker_client()
    deadline = time.time() + wait
    last_exc: Exception | None = None

    with console.status(f"Querying VPN IP for [bold]{worker_name}[/bold]..."):
        while time.time() < deadline:
            try:
                raw = exec_in_worker(
                    client, worker_name,
                    "curl -sf --max-time 8 https://ipinfo.io/json"
                )
                last_exc = None
                break
            except RuntimeError as exc:
                last_exc = exc
                time.sleep(3)

    if last_exc is not None:
        console.print(f"[red]Error:[/red] {last_exc}")
        raise SystemExit(1)

    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        console.print(f"[red]Unexpected response:[/red] {raw}")
        raise SystemExit(1)

    console.print(f"  [bold]IP[/bold]      : {info.get('ip', 'unknown')}")
    console.print(f"  [bold]City[/bold]    : {info.get('city', 'unknown')}")
    console.print(f"  [bold]Region[/bold]  : {info.get('region', 'unknown')}")
    console.print(f"  [bold]Country[/bold] : {info.get('country', 'unknown')}")
    console.print(f"  [bold]Org[/bold]     : {info.get('org', 'unknown')}")


@worker_group.command("kill")
@click.argument("worker_name", required=False, default=None)
@click.option("--all", "kill_all", is_flag=True, default=False, help="Kill every worker.")
@click.option("--keep", is_flag=True, default=False, help="Kill but do not remove the container(s).")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation prompt.")
def worker_kill(worker_name: str | None, kill_all: bool, keep: bool, yes: bool) -> None:
    """Force-kill (SIGKILL) one or all worker containers.

    \b
    Examples:
      dvd worker kill dvd-worker-a1b2       # kill a specific worker
      dvd worker kill --all                 # kill every worker (prompts first)
      dvd worker kill --all --yes           # kill every worker, no prompt
    """
    if not worker_name and not kill_all:
        console.print("[red]Error:[/red] Provide a worker name or --all.")
        raise SystemExit(1)
    if worker_name and kill_all:
        console.print("[red]Error:[/red] Provide a worker name or --all, not both.")
        raise SystemExit(1)

    client = get_docker_client()

    if kill_all:
        workers = list_workers(client)
        if not workers:
            console.print("[yellow]No workers to kill.[/yellow]")
            return
        names = [w.name for w in workers]
        if not yes:
            console.print(f"About to kill [bold]{len(names)}[/bold] worker(s): {', '.join(names)}")
            click.confirm("Proceed?", abort=True)
        with console.status(f"Killing {len(names)} worker(s)..."):
            try:
                killed = kill_all_workers(client, remove=not keep)
            except RuntimeError as exc:
                console.print(f"[red]Error:[/red] {exc}")
                raise SystemExit(1)
        for n in killed:
            action = "killed" if keep else "killed and removed"
            console.print(f"[red]✗[/red] {n} — {action}")
        console.print(f"[bold]{len(killed)}[/bold] worker(s) killed.")
    else:
        with console.status(f"Killing [bold]{worker_name}[/bold]..."):
            try:
                kill_worker(client, worker_name, remove=not keep)  # type: ignore[arg-type]
            except RuntimeError as exc:
                console.print(f"[red]Error:[/red] {exc}")
                raise SystemExit(1)
        action = "killed" if keep else "killed and removed"
        console.print(f"[red]✗[/red] {worker_name} — {action}")
