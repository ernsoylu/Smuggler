"""smg — Smuggler CLI entry point."""

from __future__ import annotations

from pathlib import Path

import click
from rich.console import Console

from cli.docker_client import build_image, get_docker_client, MULE_IMAGE, MULE_IMAGE_OVPN
from cli.mule_commands import mule_group
from cli.torrent_commands import torrent_group

console = Console()

_ROOT = Path(__file__).resolve().parent.parent
MULE_IMAGE_DIR      = _ROOT / "worker_image"
MULE_IMAGE_OVPN_DIR = _ROOT / "worker_image_ovpn"

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


cli.add_command(mule_group)
cli.add_command(torrent_group)


if __name__ == "__main__":
    cli()
