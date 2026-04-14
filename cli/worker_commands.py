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
    get_docker_client,
    get_worker,
    list_workers,
    start_worker,
    stop_worker,
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
    with console.status(f"Starting worker with [bold]{Path(config).name}[/bold]..."):
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

    console.print(f"[green]Worker started:[/green] [bold]{worker.name}[/bold]")
    console.print(f"  Container ID : {worker.id}")
    console.print(f"  aria2 RPC    : localhost:{worker.rpc_port}")
    console.print(f"  VPN config   : {worker.vpn_config}")


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
