import axios from 'axios';
import type { Worker, Torrent, GlobalStats, IpInfo } from './types';

const api = axios.create({ baseURL: '/api' });

// ── Workers ──────────────────────────────────────────────────────────────────

export const getWorkers = (): Promise<Worker[]> =>
  api.get<Worker[]>('/workers/').then(r => r.data);

export const getWorker = (name: string): Promise<Worker> =>
  api.get<Worker>(`/workers/${name}`).then(r => r.data);

export const createWorker = (vpnConfig: File, name?: string): Promise<Worker> => {
  const fd = new FormData();
  fd.append('vpn_config', vpnConfig);
  if (name) fd.append('name', name);
  return api.post<Worker>('/workers/', fd).then(r => r.data);
};

export const stopWorker = (name: string): Promise<void> =>
  api.delete(`/workers/${name}`).then(() => undefined);

export const killWorker = (name: string): Promise<void> =>
  api.post(`/workers/${name}/kill`).then(() => undefined);

export const getWorkerIp = (name: string): Promise<IpInfo> =>
  api.get<IpInfo>(`/workers/${name}/ip`).then(r => r.data);

// ── Torrents ─────────────────────────────────────────────────────────────────

export const getAllTorrents = (): Promise<Torrent[]> =>
  api.get<Torrent[]>('/torrents/').then(r => r.data);

export const getWorkerTorrents = (worker: string): Promise<Torrent[]> =>
  api.get<Torrent[]>(`/torrents/${worker}`).then(r => r.data);

export const addMagnet = (worker: string, magnet: string): Promise<{ gid: string }> =>
  api.post<{ gid: string }>(`/torrents/${worker}`, { magnet }).then(r => r.data);

export const addTorrentFile = (worker: string, file: File): Promise<{ gid: string }> => {
  const fd = new FormData();
  fd.append('torrent_file', file);
  return api.post<{ gid: string }>(`/torrents/${worker}`, fd).then(r => r.data);
};

export const removeTorrent = (worker: string, gid: string): Promise<void> =>
  api.delete(`/torrents/${worker}/${gid}`).then(() => undefined);

export const pauseTorrent = (worker: string, gid: string): Promise<void> =>
  api.post(`/torrents/${worker}/${gid}/pause`).then(() => undefined);

export const resumeTorrent = (worker: string, gid: string): Promise<void> =>
  api.post(`/torrents/${worker}/${gid}/resume`).then(() => undefined);

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

export const deployMuleFromConfig = (configId: number, name?: string): Promise<Worker> =>
  api.post<Worker>(`/configs/${configId}/deploy`, { name }).then(r => r.data);
