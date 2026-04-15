"""smg — Smuggler CLI entry point."""

from __future__ import annotations

from pathlib import Path

import click
from rich.console import Console

from cli.docker_client import build_image, get_docker_client, MULE_IMAGE
from cli.mule_commands import mule_group
from cli.torrent_commands import torrent_group

console = Console()

MULE_IMAGE_DIR = Path(__file__).resolve().parent.parent / "worker_image"


@click.group()
@click.version_option("0.1.0", prog_name="smg")
def cli() -> None:
    """smg — Smuggle torrents through isolated per-mule WireGuard VPN tunnels."""


@cli.command("build")
@click.option(
    "--context",
    default=str(MULE_IMAGE_DIR),
    show_default=True,
    type=click.Path(exists=True, file_okay=False),
    help="Path to the mule image build context.",
)
@click.option("--tag", default=MULE_IMAGE, show_default=True, help="Image tag to build.")
def build(context: str, tag: str) -> None:
    """Build the smuggler mule Docker image."""
    client = get_docker_client()
    console.print(f"Building [bold]{tag}[/bold] from [dim]{context}[/dim]...")
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
