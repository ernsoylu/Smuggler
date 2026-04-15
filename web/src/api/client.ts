import axios from 'axios';
import type { Mule, Torrent, GlobalStats, IpInfo } from './types';

const api = axios.create({ baseURL: '/api' });

// ── Mules ─────────────────────────────────────────────────────────────────────

export const getMules = (): Promise<Mule[]> =>
  api.get<Mule[]>('/mules/').then(r => r.data);

export const getMule = (name: string): Promise<Mule> =>
  api.get<Mule>(`/mules/${name}`).then(r => r.data);

export const createMule = (vpnConfig: File, name?: string): Promise<Mule> => {
  const fd = new FormData();
  fd.append('vpn_config', vpnConfig);
  if (name) fd.append('name', name);
  return api.post<Mule>('/mules/', fd).then(r => r.data);
};

export const stopMule = (name: string): Promise<void> =>
  api.delete(`/mules/${name}`).then(() => undefined);

export const killMule = (name: string): Promise<void> =>
  api.post(`/mules/${name}/kill`).then(() => undefined);

export const getMuleIp = (name: string): Promise<IpInfo> =>
  api.get<IpInfo>(`/mules/${name}/ip`).then(r => r.data);

// ── Torrents ──────────────────────────────────────────────────────────────────

export const getAllTorrents = (): Promise<Torrent[]> =>
  api.get<Torrent[]>('/torrents/').then(r => r.data);

export const getMuleTorrents = (mule: string): Promise<Torrent[]> =>
  api.get<Torrent[]>(`/torrents/${mule}`).then(r => r.data);

export const addMagnet = (mule: string, magnet: string): Promise<{ gid: string }> =>
  api.post<{ gid: string }>(`/torrents/${mule}`, { magnet }).then(r => r.data);

export const addTorrentFile = (mule: string, file: File): Promise<{ gid: string }> => {
  const fd = new FormData();
  fd.append('torrent_file', file);
  return api.post<{ gid: string }>(`/torrents/${mule}`, fd).then(r => r.data);
};

export const removeTorrent = (mule: string, gid: string): Promise<void> =>
  api.delete(`/torrents/${mule}/${gid}`).then(() => undefined);

export const pauseTorrent = (mule: string, gid: string): Promise<void> =>
  api.post(`/torrents/${mule}/${gid}/pause`).then(() => undefined);

export const resumeTorrent = (mule: string, gid: string): Promise<void> =>
  api.post(`/torrents/${mule}/${gid}/resume`).then(() => undefined);

// ── Stats ─────────────────────────────────────────────────────────────────────

export const getStats = (): Promise<GlobalStats> =>
  api.get<GlobalStats>('/stats/').then(r => r.data);

// ── Settings ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  download_dir: string;
  max_concurrent_downloads: string;
  max_download_speed: string;
  max_upload_speed: string;
}

export const getSettings = (): Promise<AppSettings> =>
  api.get<AppSettings>('/settings/').then(r => r.data);

export const saveSettings = (settings: Partial<AppSettings>): Promise<{ ok: boolean; settings: AppSettings }> =>
  api.post<{ ok: boolean; settings: AppSettings }>('/settings/', settings).then(r => r.data);

// ── VPN Configs ───────────────────────────────────────────────────────────────

export interface VpnConfig {
  id: number;
  name: string;
  filename: string;
  created_at: string;
}

export const getConfigs = (): Promise<VpnConfig[]> =>
  api.get<VpnConfig[]>('/configs/').then(r => r.data);

export const uploadConfig = (file: File, name?: string): Promise<VpnConfig> => {
  const fd = new FormData();
  fd.append('config_file', file);
  if (name) fd.append('name', name);
  return api.post<VpnConfig>('/configs/', fd).then(r => r.data);
};

export const deleteConfig = (id: number): Promise<void> =>
  api.delete(`/configs/${id}`).then(() => undefined);

export const deployMuleFromConfig = (configId: number, name?: string): Promise<Mule> =>
  api.post<Mule>(`/configs/${configId}/deploy`, { name }).then(r => r.data);
