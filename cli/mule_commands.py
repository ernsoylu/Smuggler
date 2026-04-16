"""Click commands for mule management."""

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
    exec_in_mule,
    get_container_logs,
    get_docker_client,
    get_mule,
    kill_all_mules,
    kill_mule,
    list_mules,
    start_mule,
    stop_mule,
    wait_for_vpn,
    MULE_IMAGE,
    MULE_IMAGE_OVPN,
)

console = Console()


@click.group("mule")
def mule_group() -> None:
    """Manage download mule containers."""


@mule_group.command("start")
@click.option(
    "--config",
    "-c",
    required=True,
    type=click.Path(exists=True, dir_okay=False, readable=True),
    help="Path to a WireGuard .conf or OpenVPN .ovpn file.",
)
@click.option("--name", "-n", default=None, help="Optional mule name (auto-generated if omitted).")
@click.option(
    "--vpn-type",
    type=click.Choice(["wireguard", "openvpn", "auto"], case_sensitive=False),
    default="auto",
    show_default=True,
    help="VPN type. 'auto' detects from file extension (.conf=wireguard, .ovpn=openvpn).",
)
@click.option(
    "--username",
    default=None,
    help="OpenVPN username (required when the .ovpn file uses auth-user-pass).",
)
@click.option(
    "--password",
    default=None,
    help="OpenVPN password (required when the .ovpn file uses auth-user-pass).",
)
@click.option(
    "--downloads-dir",
    default=None,
    type=click.Path(file_okay=False),
    help="Host directory for downloads (default: ./downloads).",
)
def mule_start(
    config: str,
    name: str | None,
    vpn_type: str,
    username: str | None,
    password: str | None,
    downloads_dir: str | None,
) -> None:
    """Start a new mule container with the given VPN config.

    \b
    Examples:
      smg mule start --config wg.conf                    # WireGuard (auto)
      smg mule start --config client.ovpn                # OpenVPN (auto)
      smg mule start --config client.ovpn --username u --password p
    """
    # Auto-detect VPN type from extension
    if vpn_type == "auto":
        vpn_type = "openvpn" if Path(config).suffix.lower() == ".ovpn" else "wireguard"

    # Validate required image exists (warn early rather than after container start)
    required_image = MULE_IMAGE_OVPN if vpn_type == "openvpn" else MULE_IMAGE

    client = get_docker_client()

    # ── Step 1: create the container ────────────────────────────────────────
    type_label = "[violet]OpenVPN[/violet]" if vpn_type == "openvpn" else "[cyan]WireGuard[/cyan]"
    with console.status(
        f"Creating {type_label} mule with [bold]{Path(config).name}[/bold]..."
    ):
        try:
            mule = start_mule(
                client,
                vpn_config_path=config,
                name=name,
                downloads_dir=downloads_dir,
                vpn_type=vpn_type,
                ovpn_username=username,
                ovpn_password=password,
            )
        except RuntimeError as exc:
            console.print(f"[red]Error:[/red] {exc}")
            raise SystemExit(1)

    console.print(f"Container [bold]{mule.name}[/bold] created — waiting for VPN...")

    # ── Step 2: block until VPN is up and IP is confirmed ───────────────────
    vpn_label = "OpenVPN" if vpn_type == "openvpn" else "WireGuard"
    timeout = 90 if vpn_type == "openvpn" else 60
    with console.status(f"Confirming {vpn_label} connection (up to {timeout}s)..."):
        try:
            ip_info = wait_for_vpn(client, mule.name, timeout=timeout)
        except RuntimeError as exc:
            console.print(f"\n[red]VPN failed to come up — stopping container.[/red]")
            console.print(f"[red]{exc}[/red]")
            try:
                stop_mule(client, mule.name, remove=True)
            except RuntimeError:
                pass
            raise SystemExit(1)

    console.print(f"[green]Mule ready:[/green] [bold]{mule.name}[/bold]")
    console.print(f"  Container ID : {mule.id}")
    console.print(f"  VPN type     : {vpn_type}")
    console.print(f"  aria2 RPC    : localhost:{mule.rpc_port}")
    console.print(f"  VPN config   : {mule.vpn_config}")
    console.print(f"  External IP  : [cyan]{ip_info.get('ip', '?')}[/cyan]"
                  f"  ([bold]{ip_info.get('country', '?')}[/bold]"
                  f" / {ip_info.get('city', '?')})")


@mule_group.command("list")
def mule_list() -> None:
    """List all smuggler mules."""
    client = get_docker_client()
    mules = list_mules(client)

    if not mules:
        console.print("[yellow]No mules found.[/yellow]  Start one with `smg mule start`.")
        return

    table = Table(box=box.ROUNDED, show_header=True, header_style="bold cyan")
    table.add_column("Name")
    table.add_column("ID")
    table.add_column("Status")
    table.add_column("RPC Port")
    table.add_column("VPN Config")

    for w in mules:
        status_style = "green" if w.status == "running" else "yellow"
        table.add_row(
            w.name,
            w.id,
            f"[{status_style}]{w.status}[/{status_style}]",
            str(w.rpc_port) if w.rpc_port else "-",
            w.vpn_config or "-",
        )

    console.print(table)


@mule_group.command("stop")
@click.argument("mule_name")
@click.option("--keep", is_flag=True, default=False, help="Stop but do not remove the container.")
def mule_stop(mule_name: str, keep: bool) -> None:
    """Stop (and remove) a mule container."""
    client = get_docker_client()
    with console.status(f"Stopping [bold]{mule_name}[/bold]..."):
        try:
            stop_mule(client, mule_name, remove=not keep)
        except RuntimeError as exc:
            console.print(f"[red]Error:[/red] {exc}")
            raise SystemExit(1)
    action = "stopped" if keep else "stopped and removed"
    console.print(f"[green]Mule {action}:[/green] {mule_name}")


@mule_group.command("ip")
@click.argument("mule_name")
@click.option("--wait", default=30, show_default=True, help="Seconds to wait for VPN to be ready.")
def mule_ip(mule_name: str, wait: int) -> None:
    """Display the external IP and geolocation of a mule's VPN connection."""
    client = get_docker_client()
    deadline = time.time() + wait
    last_exc: Exception | None = None

    with console.status(f"Querying VPN IP for [bold]{mule_name}[/bold]..."):
        while time.time() < deadline:
            try:
                raw = exec_in_mule(
                    client, mule_name,
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


@mule_group.command("kill")
@click.argument("mule_name", required=False, default=None)
@click.option("--all", "kill_all", is_flag=True, default=False, help="Kill every mule.")
@click.option("--keep", is_flag=True, default=False, help="Kill but do not remove the container(s).")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation prompt.")
def mule_kill(mule_name: str | None, kill_all: bool, keep: bool, yes: bool) -> None:
    """Force-kill (SIGKILL) one or all mule containers.

    \b
    Examples:
      smg mule kill my-mule             # kill a specific mule
      smg mule kill --all               # kill every mule (prompts first)
      smg mule kill --all --yes         # kill every mule, no prompt
    """
    if not mule_name and not kill_all:
        console.print("[red]Error:[/red] Provide a mule name or --all.")
        raise SystemExit(1)
    if mule_name and kill_all:
        console.print("[red]Error:[/red] Provide a mule name or --all, not both.")
        raise SystemExit(1)

    client = get_docker_client()

    if kill_all:
        mules = list_mules(client)
        if not mules:
            console.print("[yellow]No mules to kill.[/yellow]")
            return
        names = [w.name for w in mules]
        if not yes:
            console.print(f"About to kill [bold]{len(names)}[/bold] mule(s): {', '.join(names)}")
            click.confirm("Proceed?", abort=True)
        with console.status(f"Killing {len(names)} mule(s)..."):
            try:
                killed = kill_all_mules(client, remove=not keep)
            except RuntimeError as exc:
                console.print(f"[red]Error:[/red] {exc}")
                raise SystemExit(1)
        for n in killed:
            action = "killed" if keep else "killed and removed"
            console.print(f"[red]✗[/red] {n} — {action}")
        console.print(f"[bold]{len(killed)}[/bold] mule(s) killed.")
    else:
        with console.status(f"Killing [bold]{mule_name}[/bold]..."):
            try:
                kill_mule(client, mule_name, remove=not keep)  # type: ignore[arg-type]
            except RuntimeError as exc:
                console.print(f"[red]Error:[/red] {exc}")
                raise SystemExit(1)
        action = "killed" if keep else "killed and removed"
        console.print(f"[red]✗[/red] {mule_name} — {action}")
