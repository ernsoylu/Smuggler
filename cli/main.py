"""smg — Smuggler CLI entry point."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

import click
from rich.console import Console

from cli.docker_client import build_image, get_docker_client, MULE_IMAGE, MULE_IMAGE_OVPN

import docker.errors

from cli.mule_commands import mule_group
from cli.torrent_commands import torrent_group

console = Console()

_ROOT = Path(__file__).resolve().parent.parent
MULE_IMAGE_DIR      = _ROOT / "worker_image"
MULE_IMAGE_OVPN_DIR = _ROOT / "worker_image_ovpn"

API_CONTAINER = "smuggler-api"
UI_CONTAINER  = "smuggler-ui"
WEB_URL       = "http://localhost:8887"


def _container_running(name: str) -> bool:
    try:
        client = get_docker_client()
        c = client.containers.get(name)
        return c.status == "running"
    except (RuntimeError, docker.errors.NotFound, docker.errors.APIError):
        return False


def _compose_up(*services: str) -> None:
    """Start one or more services from docker-compose.yml."""
    cmd = ["docker", "compose", "up", "-d", *services]
    console.print(f"[dim]$ {' '.join(cmd)}[/dim]")
    subprocess.run(cmd, cwd=str(_ROOT), check=True)


def _ensure_api_up() -> None:
    if _container_running(API_CONTAINER):
        console.print(f"[green]✓[/green] {API_CONTAINER} already running")
        return
    console.print(f"[yellow]…[/yellow] {API_CONTAINER} not running — starting")
    _compose_up(API_CONTAINER)


def _wait_for_api(timeout: int = 30) -> bool:
    """Poll the API health endpoint until it responds OK or timeout."""
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:55555/api/health/", timeout=2) as r:
                if 200 <= r.status < 300:
                    return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False

_VPN_TYPE_DEFAULTS = {
    "wireguard": (str(MULE_IMAGE_DIR),      MULE_IMAGE),
    "openvpn":   (str(MULE_IMAGE_OVPN_DIR), MULE_IMAGE_OVPN),
}


@click.group()
@click.version_option("0.1.0", prog_name="smg")
def cli() -> None:
    """smg — Smuggle torrents through isolated per-mule WireGuard or OpenVPN tunnels."""


@cli.command("build")
@click.option(
    "--vpn-type",
    type=click.Choice(["wireguard", "openvpn"], case_sensitive=False),
    default="wireguard",
    show_default=True,
    help="VPN type to build the mule image for.",
)
@click.option(
    "--context",
    default=None,
    type=click.Path(exists=True, file_okay=False),
    help="Override the build context directory.",
)
@click.option(
    "--tag",
    default=None,
    help="Override the image tag.",
)
def build(vpn_type: str, context: str | None, tag: str | None) -> None:
    """Build a smuggler mule Docker image.

    \b
    Examples:
      smg build                        # WireGuard image (default)
      smg build --vpn-type openvpn     # OpenVPN image
      smg build --vpn-type openvpn --tag my-ovpn:v1
    """
    default_context, default_tag = _VPN_TYPE_DEFAULTS[vpn_type.lower()]
    context = context or default_context
    tag = tag or default_tag

    client = get_docker_client()
    console.print(
        f"Building [bold]{tag}[/bold] ([cyan]{vpn_type}[/cyan]) "
        f"from [dim]{context}[/dim]..."
    )
    try:
        build_image(client, context_path=context, tag=tag)
        console.print(f"[green]Image built successfully:[/green] {tag}")
    except (RuntimeError, FileNotFoundError) as exc:
        console.print(f"[red]Build failed:[/red] {exc}")
        raise SystemExit(1)


@cli.command("client")
@click.option("--no-build", is_flag=True, default=False,
              help="Fail if the desktop jar is missing instead of building it.")
def client(no_build: bool) -> None:
    """Launch the desktop client (auto-starts the API container)."""
    _ensure_api_up()

    jars = sorted((_ROOT / "desktop" / "build" / "libs").glob("smuggler-desktop-*-all.jar"))
    if not jars:
        if no_build:
            console.print("[red]Desktop jar not found.[/red] Run `./start.sh build desktop` first.")
            raise SystemExit(1)
        console.print("[yellow]…[/yellow] desktop jar missing — building (gradle shadowJar)")
        gradlew = _ROOT / "desktop" / "gradlew"
        if not gradlew.exists():
            console.print("[red]desktop/gradlew not found.[/red]")
            raise SystemExit(1)
        try:
            subprocess.run([str(gradlew), "shadowJar"], cwd=str(_ROOT / "desktop"), check=True)
        except subprocess.CalledProcessError as exc:
            console.print(f"[red]Gradle build failed:[/red] {exc}")
            raise SystemExit(1)
        jars = sorted((_ROOT / "desktop" / "build" / "libs").glob("smuggler-desktop-*-all.jar"))
        if not jars:
            console.print("[red]Build finished but no jar produced.[/red]")
            raise SystemExit(1)

    java = shutil.which("java")
    if not java:
        console.print("[red]`java` not on PATH.[/red] Install a JRE 21+ first.")
        raise SystemExit(1)

    jar = jars[-1]
    console.print(f"[green]→[/green] launching desktop client: [bold]{jar.name}[/bold]")
    env = {**os.environ, "SMG_API_URL": os.environ.get("SMG_API_URL", "http://127.0.0.1:55555")}
    subprocess.Popen([java, "-jar", str(jar)], env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


@cli.command("web")
@click.option("--no-open", is_flag=True, default=False,
              help="Start containers but don't open the browser.")
def web(no_open: bool) -> None:
    """Open the web UI (auto-starts API + UI containers)."""
    api_running = _container_running(API_CONTAINER)
    ui_running  = _container_running(UI_CONTAINER)
    if api_running and ui_running:
        console.print(f"[green]✓[/green] {API_CONTAINER} and {UI_CONTAINER} already running")
    else:
        services = []
        if not api_running: services.append(API_CONTAINER)
        if not ui_running:  services.append(UI_CONTAINER)
        console.print(f"[yellow]…[/yellow] starting: {', '.join(services)}")
        try:
            _compose_up(*services)
        except subprocess.CalledProcessError as exc:
            console.print(f"[red]docker compose failed:[/red] {exc}")
            raise SystemExit(1)
        if not _wait_for_api(timeout=30):
            console.print("[yellow]API didn't respond on :55555 yet — opening anyway[/yellow]")

    console.print(f"[green]→[/green] web UI: [cyan]{WEB_URL}[/cyan]")
    if not no_open:
        webbrowser.open(WEB_URL)


@cli.command("down")
@click.option("--yes", "-y", is_flag=True, default=False, help="Skip confirmation prompt.")
def down(yes: bool) -> None:
    """Stop all containers (api, ui, mules) and prune images + volumes."""
    if not yes:
        console.print("[yellow]This will tear down the compose stack, remove volumes/images, "
                      "and force-remove every smuggler-mule container.[/yellow]")
        click.confirm("Proceed?", abort=True)

    console.print("[bold]→ docker compose down -v --rmi all[/bold]")
    subprocess.run(["docker", "compose", "down", "-v", "--rmi", "all"],
                   cwd=str(_ROOT), check=False)

    console.print("[bold]→ removing lingering smuggler-mule containers[/bold]")
    try:
        client = get_docker_client()
        mules = client.containers.list(all=True, filters={"name": "smuggler-mule"})
    except RuntimeError as exc:
        console.print(f"[yellow]Docker unreachable:[/yellow] {exc}")
        mules = []

    if not mules:
        console.print("[dim]  no mules to remove[/dim]")
    else:
        for c in mules:
            try:
                c.remove(force=True)
                console.print(f"  [red]✗[/red] removed {c.name}")
            except docker.errors.APIError as exc:
                console.print(f"  [yellow]![/yellow] {c.name}: {exc}")

    console.print("[green]✓ down complete[/green]")


cli.add_command(mule_group)
cli.add_command(torrent_group)


if __name__ == "__main__":
    cli()
