import axios from 'axios';
import type { Mule, Torrent, GlobalStats, IpInfo, VpnConfig, MuleHealth, WatchdogStatus, Peer, TorrentOptions } from './types';

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

export const getTorrentPeers = (mule: string, gid: string): Promise<Peer[]> =>
  api.get<Peer[]>(`/torrents/${mule}/${gid}/peers`).then(r => r.data);

export const getTorrentOptions = (mule: string, gid: string): Promise<TorrentOptions> =>
  api.get<TorrentOptions>(`/torrents/${mule}/${gid}/options`).then(r => r.data);

export const setTorrentOptions = (mule: string, gid: string, opts: Partial<TorrentOptions>): Promise<void> =>
  api.patch(`/torrents/${mule}/${gid}/options`, opts).then(() => undefined);

export const setFileSelection = (mule: string, gid: string, selectedIndices: number[]): Promise<void> =>
  api.patch(`/torrents/${mule}/${gid}/files`, { selected_indices: selectedIndices }).then(() => undefined);

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

export { type VpnConfig } from './types';

export const getConfigs = (): Promise<VpnConfig[]> =>
  api.get<VpnConfig[]>('/configs/').then(r => r.data);

export const uploadConfig = (
  file: File,
  name?: string,
  username?: string,
  password?: string,
): Promise<VpnConfig> => {
  const fd = new FormData();
  fd.append('config_file', file);
  if (name) fd.append('name', name);
  if (username) fd.append('username', username);
  if (password) fd.append('password', password);
  return api.post<VpnConfig>('/configs/', fd).then(r => r.data);
};

export const deleteConfig = (id: number): Promise<void> =>
  api.delete(`/configs/${id}`).then(() => undefined);

export const deployMuleFromConfig = (configId: number, name?: string): Promise<Mule> =>
  api.post<Mule>(`/configs/${configId}/deploy`, { name }).then(r => r.data);

// ── Watchdog ──────────────────────────────────────────────────────────────────

export { type MuleHealth, type WatchdogStatus } from './types';

export const getWatchdogStatus = (): Promise<WatchdogStatus> =>
  api.get<WatchdogStatus>('/watchdog/').then(r => r.data);

export const getMuleHealth = (name: string): Promise<MuleHealth> =>
  api.get<MuleHealth>(`/mules/${name}/health`).then(r => r.data);

export const evacuateMule = (name: string, kill = true): Promise<object> =>
  api.post(`/mules/${name}/evacuate`, null, { params: { kill } }).then(r => r.data);

export const triggerWatchdogSweep = (): Promise<{ swept: number; results: MuleHealth[] }> =>
  api.post<{ swept: number; results: MuleHealth[] }>('/watchdog/run').then(r => r.data);
