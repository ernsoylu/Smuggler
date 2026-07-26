import type { Mule, Torrent, VpnConfig } from '../api/types';

/**
 * Builders for the API shapes, so a test states only the fields it cares about.
 * Defaults are a plausible mid-download torrent on a running mule.
 */

export function makeTorrent(overrides: Partial<Torrent> = {}): Torrent {
  return {
    gid: 'gid-1',
    mule: 'mule-1',
    name: 'ubuntu-24.04.iso',
    status: 'active',
    completed_length: 512,
    total_length: 1024,
    uploaded_length: 0,
    download_speed: 2048,
    upload_speed: 128,
    progress: 50,
    num_seeders: 4,
    connections: 9,
    info_hash: 'hash-1',
    is_seed: false,
    save_path: '/downloads/ubuntu',
    piece_length: 256,
    num_pieces: 4,
    eta: 120,
    ratio: 0.5,
    tracker: 'udp://tracker.example:6969',
    comment: '',
    creation_date: 0,
    mode: 'multi',
    error_code: '',
    error_message: '',
    category: '',
    files: [],
    ...overrides,
  };
}

export function makeMule(overrides: Partial<Mule> = {}): Mule {
  return {
    name: 'mule-1',
    id: 'container-abcdef123456',
    status: 'running',
    rpc_port: 6800,
    vpn_config: 'us-west.conf',
    config_id: 1,
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<VpnConfig> = {}): VpnConfig {
  return {
    id: 1,
    name: 'US West',
    filename: 'us-west.conf',
    created_at: '2026-01-01T00:00:00Z',
    vpn_type: 'wireguard',
    requires_auth: false,
    ...overrides,
  };
}
