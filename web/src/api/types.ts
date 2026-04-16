export interface MuleHealth {
  name: string;
  healthy: boolean;
  ip: string | null;
  reason: string;
  checked_at?: string;
  consecutive_failures?: number;
  evacuated?: boolean;
}

export interface WatchdogStatus {
  config: { interval_seconds: number; failure_threshold: number };
  stats: {
    started_at: string | null;
    last_run_at: string | null;
    total_sweeps: number;
    total_evacuations: number;
  };
  mules: MuleHealth[];
}

export interface Mule {
  name: string;
  id: string;
  status: string;
  rpc_port: number;
  vpn_config: string;
  ip_info?: IpInfo;
}

export interface IpInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  org: string;
}

export interface TorrentFile {
  index: number;
  path: string;
  name: string;
  total_length: number;
  completed_length: number;
  progress: number;
  selected: boolean;
}

export interface Torrent {
  gid: string;
  mule: string;
  name: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  completed_length: number;
  total_length: number;
  uploaded_length: number;
  download_speed: number;
  upload_speed: number;
  progress: number;
  num_seeders: number;
  connections: number;
  info_hash: string;
  is_seed: boolean;
  save_path: string;
  piece_length: number;
  num_pieces: number;
  eta: number;
  ratio: number;
  tracker: string;
  comment: string;
  creation_date: number;
  mode: string;
  error_code: string;
  error_message: string;
  files: TorrentFile[];
  is_metadata?: boolean;
}

export interface Peer {
  ip: string;
  port: string;
  download_speed: number;
  upload_speed: number;
  seeder: boolean;
  progress: number;
  am_choking: boolean;
  peer_choking: boolean;
}

export interface TorrentOptions {
  max_download_speed: number;
  max_upload_speed: number;
  max_connections: number;
}

export interface GlobalStats {
  download_speed: number;
  upload_speed: number;
  num_active: number;
  num_waiting: number;
  num_stopped: number;
  num_mules: number;
  disk_free?: number | null;
  disk_total?: number | null;
}

export interface VpnConfig {
  id: number;
  name: string;
  filename: string;
  created_at: string;
  vpn_type: 'wireguard' | 'openvpn';
  requires_auth: boolean;
}
