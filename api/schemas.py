"""Typed response shapes shared across blueprints."""

from __future__ import annotations

from typing import TypedDict, Optional


class WorkerSchema(TypedDict):
    name: str
    id: str
    status: str
    rpc_port: int
    vpn_config: str


class IpInfoSchema(TypedDict):
    ip: str
    city: str
    region: str
    country: str
    org: str


class WorkerDetailSchema(WorkerSchema):
    ip_info: Optional[IpInfoSchema]


class TorrentSchema(TypedDict):
    gid: str
    worker: str
    name: str
    status: str
    completed_length: int
    total_length: int
    download_speed: int
    upload_speed: int
    progress: float        # 0.0 – 100.0
    num_seeders: int
    connections: int


class GlobalStatsSchema(TypedDict):
    download_speed: int    # bytes/s across all workers
    upload_speed: int
    num_active: int
    num_waiting: int
    num_stopped: int
