import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  removeTorrent, pauseTorrent, resumeTorrent,
  getTorrentPeers, getTorrentOptions, setTorrentOptions, setFileSelection,
} from '../api/client';
import type { Torrent, Peer, TorrentOptions } from '../api/types';
import {
  Play, Pause, Trash2, ChevronDown, ChevronRight,
  File as FileIcon, Users, Settings2, Info, HardDrive
} from 'lucide-react';
import { DeleteTorrentModal } from './DeleteTorrentModal';

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_024) return `${(bytesPerSec / 1_024).toFixed(0)} KB/s`;
  return bytesPerSec > 0 ? `${bytesPerSec} B/s` : '—';
}

function formatEta(seconds: number): string {
  if (seconds < 0) return '∞';
  if (seconds === 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const STATUS_VARIANTS: Record<string, { bg: string; text: string; ring: string; line: string }> = {
  active:   { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', line: 'bg-emerald-500' },
  waiting:  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  ring: 'ring-orange-500/20',  line: 'bg-orange-500' },
  paused:   { bg: 'bg-blue-500/10',    text: 'text-blue-400',    ring: 'ring-blue-500/20',    line: 'bg-blue-500' },
  error:    { bg: 'bg-red-500/10',     text: 'text-red-400',     ring: 'ring-red-500/20',     line: 'bg-red-500' },
  complete: { bg: 'bg-neutral-500/10', text: 'text-neutral-400', ring: 'ring-neutral-500/20', line: 'bg-neutral-500' },
  removed:  { bg: 'bg-neutral-800/50', text: 'text-neutral-500', ring: 'ring-transparent',    line: 'bg-neutral-600' },
};

type DetailTab = 'status' | 'details' | 'files' | 'peers' | 'options';

const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
  { id: 'status',  label: 'Status',  icon: <Info size={13} /> },
  { id: 'details', label: 'Details', icon: <HardDrive size={13} /> },
  { id: 'files',   label: 'Files',   icon: <FileIcon size={13} /> },
  { id: 'peers',   label: 'Peers',   icon: <Users size={13} /> },
  { id: 'options', label: 'Options', icon: <Settings2 size={13} /> },
];

// ── Sub-panels ────────────────────────────────────────────────────────────────

function StatusTab({ torrent }: { torrent: Torrent }) {
  const v = STATUS_VARIANTS[torrent.status] ?? STATUS_VARIANTS['removed'];
  const progress = Math.min(100, torrent.progress);
  const remaining = torrent.total_length - torrent.completed_length;
  return (
    <div className="space-y-4">
      {/* Large progress bar */}
      <div>
        <div className="flex justify-between items-center text-xs mb-1.5">
          <span className="text-neutral-400">{progress.toFixed(2)}% complete</span>
          {torrent.eta >= 0 && torrent.status === 'active' && (
            <span className="text-neutral-500">ETA: {formatEta(torrent.eta)}</span>
          )}
        </div>
        <div className="w-full h-3 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${v.line} transition-all duration-500 rounded-full`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Downloaded</span>
          <span className="text-emerald-400 font-mono">{formatBytes(torrent.completed_length)}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Uploaded</span>
          <span className="text-blue-400 font-mono">{formatBytes(torrent.uploaded_length)}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Remaining</span>
          <span className="text-neutral-200 font-mono">{remaining > 0 ? formatBytes(remaining) : '—'}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Ratio</span>
          <span className="text-neutral-200 font-mono">{torrent.ratio.toFixed(3)}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">DL Speed</span>
          <span className="text-emerald-400 font-mono">{formatSpeed(torrent.download_speed)}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">UL Speed</span>
          <span className="text-blue-400 font-mono">{formatSpeed(torrent.upload_speed)}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Seeds</span>
          <span className="text-neutral-200 font-mono">{torrent.num_seeders}</span>
        </div>
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Peers</span>
          <span className="text-neutral-200 font-mono">{torrent.connections}</span>
        </div>
        {torrent.is_seed && (
          <div className="bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/20">
            <span className="text-emerald-400 font-semibold">Seeding</span>
          </div>
        )}
        {torrent.tracker && (
          <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2 md:col-span-3">
            <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Tracker</span>
            <span className="text-neutral-300 font-mono text-[10px] truncate block">{torrent.tracker}</span>
          </div>
        )}
        {torrent.error_message && (
          <div className="bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 col-span-2 md:col-span-4">
            <span className="text-red-400 font-semibold uppercase tracking-wider block mb-0.5">Error ({torrent.error_code})</span>
            <span className="text-red-300 text-[11px]">{torrent.error_message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailsTab({ torrent }: { torrent: Torrent }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
        <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Total Size</span>
        <span className="text-neutral-200 font-mono">{formatBytes(torrent.total_length)}</span>
      </div>
      {torrent.mode && (
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Mode</span>
          <span className="text-neutral-200 font-mono capitalize">{torrent.mode}</span>
        </div>
      )}
      {torrent.num_pieces > 0 && (
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Pieces</span>
          <span className="text-neutral-200 font-mono">{torrent.num_pieces} × {formatBytes(torrent.piece_length)}</span>
        </div>
      )}
      {torrent.creation_date > 0 && (
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Created</span>
          <span className="text-neutral-200 font-mono text-[10px]">
            {new Date(torrent.creation_date * 1000).toLocaleDateString()}
          </span>
        </div>
      )}
      {torrent.info_hash && (
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2 md:col-span-4">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Info Hash</span>
          <span className="text-neutral-300 font-mono text-[10px] break-all">{torrent.info_hash}</span>
        </div>
      )}
      {torrent.save_path && (
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2 md:col-span-4">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Save Path</span>
          <span className="text-neutral-300 font-mono text-[10px] truncate block">{torrent.save_path}</span>
        </div>
      )}
      {torrent.comment && (
        <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2 md:col-span-4">
          <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Comment</span>
          <span className="text-neutral-300 text-[11px]">{torrent.comment}</span>
        </div>
      )}
    </div>
  );
}

function FilesTab({ torrent }: { torrent: Torrent }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Set<number>>(new Set());

  const toggleFile = useMutation({
    mutationFn: async (fileIndex: number) => {
      const selected = torrent.files.filter(f => f.selected).map(f => f.index);
      let next: number[];
      if (selected.includes(fileIndex)) {
        next = selected.filter(i => i !== fileIndex);
      } else {
        next = [...selected, fileIndex];
      }
      await setFileSelection(torrent.mule, torrent.gid, next);
      return { fileIndex, next };
    },
    onMutate: (fileIndex) => setPending(prev => new Set([...prev, fileIndex])),
    onSettled: (_data, _err, fileIndex) =>
      setPending(prev => { const s = new Set(prev); s.delete(fileIndex); return s; }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  if (!torrent.files || torrent.files.length === 0) {
    return <p className="text-xs text-neutral-500 py-2">No file information available.</p>;
  }

  return (
    <table className="w-full text-xs text-left">
      <thead>
        <tr className="text-neutral-500 font-semibold uppercase tracking-wider">
          <th className="w-[40px] pb-2 text-center">#</th>
          <th className="pb-2">Filename</th>
          <th className="w-[100px] pb-2 text-right">Size</th>
          <th className="w-[160px] pb-2 pl-4">Progress</th>
          <th className="w-[90px] pb-2 text-center">Priority</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {torrent.files.map((file) => (
          <tr
            key={file.index}
            className={`hover:bg-white/[0.03] transition-colors ${file.selected ? '' : 'opacity-50'}`}
          >
            <td className="py-2 text-center text-neutral-500 font-mono">{file.index}</td>
            <td className="py-2 pr-4">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon size={13} className="text-neutral-500 shrink-0" />
                <span className="truncate text-neutral-300 max-w-[320px]" title={file.name}>{file.name}</span>
              </div>
            </td>
            <td className="py-2 text-right text-neutral-400 font-mono pr-4">{formatBytes(file.total_length)}</td>
            <td className="py-2 pl-4">
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-neutral-500">{formatBytes(file.completed_length)}</span>
                  <span className="text-neutral-400">{file.progress.toFixed(1)}%</span>
                </div>
                <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${file.progress === 100 ? 'bg-neutral-500' : 'bg-blue-500'} transition-all`}
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
              </div>
            </td>
            <td className="py-2 text-center">
              <button
                onClick={() => toggleFile.mutate(file.index)}
                disabled={pending.has(file.index)}
                className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ring-1 ${
                  file.selected
                    ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20 hover:bg-emerald-500/20'
                    : 'bg-neutral-800 text-neutral-500 ring-white/5 hover:bg-neutral-700'
                }`}
                title={file.selected ? 'Click to skip this file' : 'Click to download this file'}
              >
                {file.selected ? 'Normal' : 'Skip'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PeerFlag({ ip }: { ip: string }) {
  const { data: flag } = useQuery({
    queryKey: ['geo-ip', ip],
    queryFn: async () => {
      try {
        // Handle basic IPv6 loopback or local IPs
        if (ip.startsWith('127.') || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
          return '🏠';
        }
        const res = await fetch(`https://get.geojs.io/v1/ip/country/${ip}`);
        if (!res.ok) return '🏳️';
        const code = (await res.text()).trim();
        if (!code || code === 'nil' || code.length !== 2) return '🏳️';
        
        const codePoints = code
          .toUpperCase()
          .split('')
          .map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
      } catch (e) {
        return '🏳️';
      }
    },
    staleTime: Infinity,
  });
  
  if (!flag) return <span className="inline-block w-4 h-4 bg-white/10 rounded animate-pulse mr-2 align-middle"></span>;
  return <span className="mr-2 text-[14px] leading-none select-none align-middle" title="Location">{flag}</span>;
}

function PeersTab({ torrent, isVisible }: { torrent: Torrent; isVisible: boolean }) {
  const { data: peers = [], isLoading } = useQuery<Peer[]>({
    queryKey: ['peers', torrent.mule, torrent.gid],
    queryFn: () => getTorrentPeers(torrent.mule, torrent.gid),
    enabled: isVisible,
    refetchInterval: isVisible ? 3_000 : false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-neutral-500">
        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading peers…
      </div>
    );
  }

  if (peers.length === 0) {
    return <p className="text-xs text-neutral-500 py-2">No active peers connected.</p>;
  }

  return (
    <table className="w-full text-xs text-left">
      <thead>
        <tr className="text-neutral-500 font-semibold uppercase tracking-wider">
          <th className="pb-2">IP Address</th>
          <th className="pb-2 text-right">DL Speed</th>
          <th className="pb-2 text-right">UL Speed</th>
          <th className="pb-2 text-center">Progress</th>
          <th className="pb-2 text-center">Type</th>
          <th className="pb-2 text-center">Choked</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {peers.map((peer) => (
          <tr key={`${peer.ip}:${peer.port}`} className="hover:bg-white/[0.03] transition-colors">
            <td className="py-2 font-mono text-neutral-300">
              <PeerFlag ip={peer.ip} />
              {peer.ip}:{peer.port}
            </td>
            <td className="py-2 text-right text-emerald-400 font-mono">{formatSpeed(peer.download_speed)}</td>
            <td className="py-2 text-right text-blue-400 font-mono">{formatSpeed(peer.upload_speed)}</td>
            <td className="py-2 text-center">
              <div className="flex items-center gap-1 justify-center">
                <div className="w-16 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-neutral-500 rounded-full" style={{ width: `${peer.progress * 100}%` }} />
                </div>
                <span className="text-neutral-500 text-[10px] font-mono">{(peer.progress * 100).toFixed(0)}%</span>
              </div>
            </td>
            <td className="py-2 text-center">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${peer.seeder ? 'bg-emerald-500/10 text-emerald-400' : 'bg-neutral-800 text-neutral-500'}`}>
                {peer.seeder ? 'Seed' : 'Peer'}
              </span>
            </td>
            <td className="py-2 text-center">
              {peer.peer_choking ? (
                <span className="text-orange-400 text-[10px]">Choked</span>
              ) : (
                <span className="text-neutral-600 text-[10px]">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OptionsTab({ torrent, isVisible }: { torrent: Torrent; isVisible: boolean }) {
  const qc = useQueryClient();
  const [localOpts, setLocalOpts] = useState<Partial<TorrentOptions>>({});
  const [saved, setSaved] = useState(false);

  const { data: options, isLoading } = useQuery<TorrentOptions>({
    queryKey: ['torrent-options', torrent.mule, torrent.gid],
    queryFn: () => getTorrentOptions(torrent.mule, torrent.gid),
    enabled: isVisible,
  });

  const save = useMutation({
    mutationFn: () => setTorrentOptions(torrent.mule, torrent.gid, localOpts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['torrent-options', torrent.mule, torrent.gid] });
      setLocalOpts({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-neutral-500">
        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading options…
      </div>
    );
  }

  const current = { ...options, ...localOpts } as TorrentOptions;
  const isDirty = Object.keys(localOpts).length > 0;

  const inputClass = "w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-neutral-200 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500/50";
  const labelClass = "text-xs text-neutral-500 font-semibold uppercase tracking-wider block mb-1.5";

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-xs text-neutral-500">
        Override global bandwidth limits for this torrent. Set to <span className="text-neutral-300 font-mono">0</span> to use the global limit.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="opt-max-dl" className={labelClass}>Max Download (B/s)</label>
          <input
            id="opt-max-dl"
            type="number"
            min={0}
            className={inputClass}
            value={localOpts.max_download_speed ?? current.max_download_speed ?? 0}
            onChange={e => setLocalOpts(o => ({ ...o, max_download_speed: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label htmlFor="opt-max-ul" className={labelClass}>Max Upload (B/s)</label>
          <input
            id="opt-max-ul"
            type="number"
            min={0}
            className={inputClass}
            value={localOpts.max_upload_speed ?? current.max_upload_speed ?? 0}
            onChange={e => setLocalOpts(o => ({ ...o, max_upload_speed: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label htmlFor="opt-max-conn" className={labelClass}>Max Connections</label>
          <input
            id="opt-max-conn"
            type="number"
            min={1}
            max={16}
            className={inputClass}
            value={localOpts.max_connections ?? current.max_connections ?? 1}
            onChange={e => setLocalOpts(o => ({ ...o, max_connections: Number(e.target.value) }))}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={!isDirty || save.isPending}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            isDirty && !save.isPending
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
          }`}
        >
          {save.isPending ? 'Saving…' : 'Apply'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Saved!</span>}
        {save.isError && <span className="text-xs text-red-400">Failed to save</span>}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  torrent: Torrent;
}

export function TorrentRow({ torrent }: Readonly<Props>) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('status');

  const pause = useMutation({
    mutationFn: () => pauseTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const resume = useMutation({
    mutationFn: () => resumeTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const remove = useMutation({
    mutationFn: (deleteFiles: boolean) => removeTorrent(torrent.mule, torrent.gid, deleteFiles),
    onSuccess: () => {
      setShowConfirm(false);
      qc.invalidateQueries({ queryKey: ['torrents'] });
    },
  });

  const progress = Math.min(100, torrent.progress);
  
  const startDisabled = torrent.status === 'active' || torrent.status === 'waiting';
  const stopDisabled = torrent.status === 'paused' || torrent.status === 'complete' || torrent.status === 'error' || torrent.status === 'removed';
  
  const v = STATUS_VARIANTS[torrent.status] ?? STATUS_VARIANTS['removed'];

  return (
    <React.Fragment>
      <tr className="group hover:bg-white/[0.02] transition-colors">
        {/* Name */}
        <td className="px-6 py-4 max-w-[260px] relative">
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${v.line} opacity-0 group-hover:opacity-100 transition-opacity rounded-r-sm`} />
          <div className="flex items-start gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-0.5 p-0.5 rounded hover:bg-white/10 text-neutral-400 transition-colors shrink-0"
              title={isExpanded ? 'Collapse' : 'Expand details'}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <div className="flex flex-col min-w-0">
              <p className="text-sm text-neutral-100 font-medium truncate" title={torrent.name}>
                {torrent.name || torrent.gid}
              </p>
              <p className="text-[11px] text-neutral-500 font-mono mt-1 tracking-tight truncate">
                {torrent.mule} • {torrent.gid}
              </p>
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="px-4 py-4 whitespace-nowrap">
          <span className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize ring-1 inset-ring ${v.bg} ${v.text} ${v.ring}`}>
            {torrent.status}
            {torrent.is_metadata && ' (Meta)'}
          </span>
        </td>

        {/* Progress */}
        <td className="px-4 py-4 min-w-[180px]">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-neutral-400 font-medium">{formatBytes(torrent.completed_length)} / {formatBytes(torrent.total_length)}</span>
              <span className="text-neutral-300 font-semibold">{progress.toFixed(1)}%</span>
            </div>
            <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${v.line} transition-all duration-500 rounded-full`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </td>

        {/* ETA */}
        <td className="px-4 py-4 whitespace-nowrap text-right">
          <span className="text-xs text-neutral-400 font-mono">
            {torrent.status === 'active' && torrent.eta !== 0 ? formatEta(torrent.eta) : '—'}
          </span>
        </td>

        {/* Speed */}
        <td className="px-4 py-4 whitespace-nowrap text-right">
          <div className="flex flex-col gap-0.5 text-xs font-medium">
            <span className="text-emerald-400">{formatSpeed(torrent.download_speed)} ↓</span>
            <span className="text-blue-400">{formatSpeed(torrent.upload_speed)} ↑</span>
          </div>
        </td>

        {/* Seeds / Peers */}
        <td className="px-4 py-4 whitespace-nowrap text-center">
          <div className="flex justify-center gap-1.5">
            <span className="px-2 py-0.5 bg-neutral-800/50 text-neutral-400 rounded ring-1 ring-white/5 text-xs font-mono" title="Seeders">{torrent.num_seeders}</span>
            <span className="px-2 py-0.5 bg-neutral-800/50 text-neutral-400 rounded ring-1 ring-white/5 text-xs font-mono" title="Peers">{torrent.connections}</span>
          </div>
        </td>

        {/* Ratio */}
        <td className="px-4 py-4 whitespace-nowrap text-right">
          <span className={`text-xs font-mono ${torrent.ratio >= 1 ? 'text-emerald-400' : 'text-neutral-400'}`}>
            {torrent.ratio.toFixed(3)}
          </span>
        </td>

        {/* Mule */}
        <td className="px-4 py-4 whitespace-nowrap">
          <span className="px-2 py-1 bg-white/5 text-neutral-300 rounded text-xs font-mono ring-1 ring-white/10">
            {torrent.mule}
          </span>
        </td>

        {/* Actions */}
        <td className="px-6 py-4 whitespace-nowrap text-right">
          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="p-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => resume.mutate()}
              disabled={startDisabled || resume.isPending}
              title="Start"
            >
              <Play size={16} />
            </button>
            <button
              className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => pause.mutate()}
              disabled={stopDisabled || pause.isPending}
              title="Stop"
            >
              <Pause size={16} />
            </button>
            <button
              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
              onClick={() => setShowConfirm(true)}
              title="Remove"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded Detail Panel with Tabs */}
      {isExpanded && (
        <tr className="bg-neutral-950/40">
          <td colSpan={9} className="p-0 border-t border-white/5 shadow-inner">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-14 pt-3 border-b border-white/5">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors ${
                    activeTab === tab.id
                      ? 'bg-white/[0.06] text-white border-b-2 border-blue-500 -mb-px'
                      : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="px-14 py-4 max-h-[420px] overflow-y-auto custom-scrollbar">
              {activeTab === 'status'  && <StatusTab torrent={torrent} />}
              {activeTab === 'details' && <DetailsTab torrent={torrent} />}
              {activeTab === 'files'   && <FilesTab torrent={torrent} />}
              {activeTab === 'peers'   && <PeersTab torrent={torrent} isVisible={isExpanded && activeTab === 'peers'} />}
              {activeTab === 'options' && <OptionsTab torrent={torrent} isVisible={isExpanded && activeTab === 'options'} />}
            </div>
          </td>
        </tr>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteTorrentModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={(deleteFiles) => remove.mutate(deleteFiles)}
        isPending={remove.isPending}
        torrentName={torrent.name || torrent.gid}
      />
    </React.Fragment>
  );
}
