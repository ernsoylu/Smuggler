import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { stopMule, killMule, getMuleTorrents } from '../api/client';
import type { Mule } from '../api/types';
import { SpeedGraph } from './SpeedGraph';
import type { DataPoint } from './SpeedGraph';
import {
  Power, Trash2, Globe2, Shield, Radio, TerminalSquare,
  ChevronDown, ChevronUp, CheckCircle2, PauseCircle, Download,
} from 'lucide-react';

const MAX_POINTS = 60;

function fmt(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps >= 1_024)     return `${(bps / 1_024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
  return `${b} B`;
}

interface Props {
  worker: Mule;
}

export function WorkerCard({ worker }: Props) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState<'stop' | 'kill' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<DataPoint[]>([]);

  const stop = useMutation({
    mutationFn: () => stopMule(worker.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  });

  const kill = useMutation({
    mutationFn: () => killMule(worker.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  });

  // Per-mule torrent polling — only when card is expanded
  const { data: torrents = [] } = useQuery({
    queryKey: ['mule-torrents', worker.name],
    queryFn: () => getMuleTorrents(worker.name),
    refetchInterval: expanded ? 2_000 : false,
    enabled: expanded && worker.status === 'running',
  });

  // Build speed history from torrent data
  useEffect(() => {
    if (!expanded || torrents.length === 0) return;
    const dl = torrents.reduce((s, t) => s + (t.download_speed ?? 0), 0);
    const ul = torrents.reduce((s, t) => s + (t.upload_speed ?? 0), 0);
    setHistory(prev =>
      [...prev, { t: Date.now(), down: dl, up: ul }].slice(-MAX_POINTS)
    );
  }, [torrents, expanded]);

  // Reset history when collapsed
  useEffect(() => {
    if (!expanded) setHistory([]);
  }, [expanded]);

  const isRunning = worker.status === 'running';
  const statusColor = isRunning ? 'bg-emerald-500' : 'bg-neutral-500';
  const statusText  = isRunning ? 'text-emerald-400' : 'text-neutral-400';
  const statusBg    = isRunning ? 'bg-emerald-500/10' : 'bg-neutral-500/10';
  const statusRing  = isRunning ? 'ring-emerald-500/20' : 'ring-neutral-500/20';
  const ip = worker.ip_info;

  // Derived torrent stats when expanded
  const activeCount   = torrents.filter(t => t.status === 'active').length;
  const pausedCount   = torrents.filter(t => t.status === 'paused').length;
  const completeCount = torrents.filter(t => t.status === 'complete').length;
  const totalDl = torrents.reduce((s, t) => s + (t.completed_length ?? 0), 0);
  const totalUl = torrents.reduce((s, t) => s + (t.uploaded_length ?? 0), 0);
  const liveDl  = torrents.reduce((s, t) => s + (t.download_speed ?? 0), 0);
  const liveUl  = torrents.reduce((s, t) => s + (t.upload_speed ?? 0), 0);

  return (
    <div className="bg-neutral-900/40 backdrop-blur-sm border border-white/5 hover:border-white/10 shadow-xl rounded-2xl flex flex-col transition-all group overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5 bg-neutral-900/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3 min-w-0">
            <div className={`mt-1 w-2.5 h-2.5 rounded-full ${statusColor} shrink-0`} />
            <div className="min-w-0">
              <p className="font-semibold text-white tracking-tight truncate text-base">{worker.name}</p>
              <p className="text-xs text-neutral-500 font-mono tracking-tighter mt-0.5">{worker.id.slice(0, 12)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-md font-semibold capitalize ring-1 inset-ring ${statusText} ${statusBg} ${statusRing}`}>
              {worker.status}
            </span>
            {/* Expand toggle */}
            {isRunning && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
                title={expanded ? 'Collapse' : 'Expand stats'}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 flex flex-col gap-4 flex-1">

        {/* Network info */}
        {ip ? (
          <div className="bg-neutral-950/50 rounded-xl p-3 border border-white/5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"><Globe2 size={14}/> IP</span>
              <span className="font-mono text-neutral-200 font-medium">{ip.ip}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"><Shield size={14}/> Loc</span>
              <span className="text-neutral-300 font-medium truncate ml-4">
                {[ip.city, ip.region, ip.country].filter(Boolean).join(', ')}
              </span>
            </div>
            {ip.org && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"><Radio size={14}/> ISP</span>
                <span className="text-neutral-400 truncate max-w-[150px] text-right">{ip.org}</span>
              </div>
            )}
          </div>
        ) : isRunning ? (
          <div className="bg-neutral-950/50 rounded-xl p-4 border border-white/5 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
            <span className="text-xs font-medium text-emerald-400">Establishing tunnel...</span>
          </div>
        ) : null}

        {/* Config meta */}
        <div className="flex flex-col gap-2 text-sm mt-auto">
          <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg">
            <span className="text-neutral-500 font-medium text-xs">Config</span>
            <span className="text-neutral-300 font-mono text-xs truncate max-w-[140px]">{worker.vpn_config}</span>
          </div>
          <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg">
            <span className="text-neutral-500 font-medium text-xs flex items-center gap-1.5"><TerminalSquare size={14}/> RPC Port</span>
            <span className="text-neutral-300 font-mono text-xs font-semibold">{worker.rpc_port}</span>
          </div>
        </div>
      </div>

      {/* ── Expanded stats panel ─────────────────────────────────────────────── */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? '600px' : '0px' }}
      >
        <div className="border-t border-white/5 bg-neutral-950/30">
          {/* Speed graph */}
          <div className="px-4 pt-4 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">Speed</p>
            <SpeedGraph data={history} height={110} />
          </div>

          {/* Live speed row */}
          <div className="px-4 pb-3 flex gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <Download size={11} className="text-emerald-400" />
              <span className="font-mono font-semibold text-emerald-300">{fmt(liveDl)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Download size={11} className="text-blue-400 rotate-180" />
              <span className="font-mono font-semibold text-blue-300">{fmt(liveUl)}</span>
            </div>
          </div>

          {/* Torrent stat pills */}
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {activeCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {activeCount} active
              </span>
            )}
            {pausedCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
                <PauseCircle size={11} />
                {pausedCount} paused
              </span>
            )}
            {completeCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-neutral-700/60 text-neutral-400 border border-white/5">
                <CheckCircle2 size={11} />
                {completeCount} done
              </span>
            )}
            {torrents.length === 0 && (
              <span className="text-[11px] text-neutral-500 italic">No torrents</span>
            )}
          </div>

          {/* Total transferred */}
          {(totalDl > 0 || totalUl > 0) && (
            <div className="px-4 pb-4 flex gap-4 text-xs text-neutral-500">
              <span>↓ {fmtBytes(totalDl)}</span>
              <span>↑ {fmtBytes(totalUl)}</span>
            </div>
          )}

          {/* Compact torrent list */}
          {torrents.length > 0 && (
            <div className="px-4 pb-4 flex flex-col gap-1">
              {torrents.slice(0, 5).map(t => {
                const pct = t.total_length > 0 ? Math.round((t.completed_length / t.total_length) * 100) : 0;
                const statusColor =
                  t.status === 'active'   ? 'text-emerald-400' :
                  t.status === 'paused'   ? 'text-amber-400'   :
                  t.status === 'error'    ? 'text-red-400'      :
                  t.status === 'complete' ? 'text-neutral-500'  : 'text-neutral-500';
                return (
                  <div key={t.gid} className="flex items-center gap-2 text-[11px]">
                    <div className="flex-1 min-w-0">
                      <p className={`truncate font-medium ${statusColor}`}>{t.name || t.gid}</p>
                      <div className="w-full h-0.5 bg-neutral-800 rounded-full mt-0.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${t.status === 'complete' ? 'bg-neutral-500' : 'bg-emerald-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-neutral-500 shrink-0 font-mono">{pct}%</span>
                  </div>
                );
              })}
              {torrents.length > 5 && (
                <p className="text-[10px] text-neutral-600 mt-1">+{torrents.length - 5} more</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer — actions */}
      <div className="p-4 bg-neutral-950/50 border-t border-white/5 mt-auto">
        {showConfirm ? (
          <div className="flex items-center gap-2 bg-red-500/10 p-1.5 rounded-xl ring-1 ring-red-500/20">
            <span className="text-xs font-semibold text-red-400 flex-1 ml-2">
              {showConfirm === 'stop' ? 'Stop Gracefully?' : 'Kill Immediately?'}
            </span>
            <button
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors"
              onClick={() => {
                if (showConfirm === 'stop') stop.mutate();
                else kill.mutate();
                setShowConfirm(null);
              }}
            >
              Yes
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-semibold transition-colors"
              onClick={() => setShowConfirm(null)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              className="flex items-center justify-center gap-1.5 flex-1 text-sm font-semibold py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white transition-colors disabled:opacity-50"
              onClick={() => setShowConfirm('stop')}
              disabled={stop.isPending || kill.isPending}
            >
              <Power size={16} /> Stop
            </button>
            <button
              className="flex items-center justify-center gap-1.5 flex-1 text-sm font-semibold py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors disabled:opacity-50"
              onClick={() => setShowConfirm('kill')}
              disabled={stop.isPending || kill.isPending}
            >
              <Trash2 size={16} /> Kill
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
