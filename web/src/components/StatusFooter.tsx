/**
 * Persistent status bar footer — visible on all pages.
 *
 * Collapsed: shows ↓ DL / ↑ UL speeds, active torrents, active mules.
 * Expanded:  also shows the D3 SpeedGraph with rolling history.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStats, getAllTorrents } from '../api/client';
import { SpeedGraph } from './SpeedGraph';
import type { DataPoint } from './SpeedGraph';
import { ChevronUp, ChevronDown, Activity, Download, Upload, Server } from 'lucide-react';

const MAX_POINTS = 60;

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function StatusFooter() {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<DataPoint[]>([]);

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 2_000,
  });

  const { data: torrents = [] } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
    refetchInterval: 2_000,
  });

  // Build rolling history from stats
  useEffect(() => {
    if (!stats) return;
    setHistory(prev =>
      [...prev, { t: Date.now(), down: stats.download_speed, up: stats.upload_speed }]
        .slice(-MAX_POINTS)
    );
  }, [stats]);

  const dl   = stats?.download_speed ?? 0;
  const ul   = stats?.upload_speed   ?? 0;
  const active  = stats?.num_active   ?? 0;
  const waiting = stats?.num_waiting  ?? 0;
  const mules   = stats?.num_mules    ?? 0;

  const totalDownloaded = torrents.reduce((sum, t) => sum + t.completed_length, 0);
  const totalUploaded   = torrents.reduce((sum, t) => sum + t.uploaded_length, 0);
  const avgRatio = torrents.length > 0
    ? (torrents.reduce((sum, t) => sum + t.ratio, 0) / torrents.length)
    : 0;

  const counts = {
    active: torrents.filter(t => t.status === 'active').length,
    waiting: torrents.filter(t => t.status === 'waiting').length,
    paused: torrents.filter(t => t.status === 'paused').length,
    complete: torrents.filter(t => t.status === 'complete').length,
    error: torrents.filter(t => t.status === 'error').length,
  };

  const isActive = dl > 0 || ul > 0 || active > 0;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 bg-neutral-950/90 backdrop-blur-xl border-t border-white/8 shadow-2xl shadow-black/50">
      {/* Graph panel — slides open above the bar */}
      <div
        className="overflow-hidden transition-all duration-500 ease-in-out bg-neutral-900 border-b border-black/50"
        style={{ maxHeight: expanded ? '240px' : '0px' }}
      >
        <div className="px-6 py-4 max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-10">
          <div className="flex-1 w-full relative">
            <p className="absolute -top-1 left-2 text-[10px] text-neutral-500 uppercase tracking-widest font-semibold z-10">Bandwidth History</p>
            <div className="pt-4">
              <SpeedGraph data={history} height={140} />
            </div>
          </div>
          
          <div className="w-px h-32 bg-white/10 hidden md:block shrink-0"></div>
          
          <div className="flex items-start gap-10 shrink-0">
            <div className="space-y-3 min-w-[140px]">
              <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-4">Transfer Summary</h4>
              <div className="flex justify-between gap-6 text-sm">
                <span className="text-neutral-400">Downloaded</span>
                <span className="text-neutral-200 font-mono font-medium">{formatBytes(totalDownloaded)}</span>
              </div>
              <div className="flex justify-between gap-6 text-sm">
                <span className="text-neutral-400">Uploaded</span>
                <span className="text-neutral-200 font-mono font-medium">{formatBytes(totalUploaded)}</span>
              </div>
              <div className="flex justify-between gap-6 text-sm">
                <span className="text-neutral-400">Avg Ratio</span>
                <span className="text-neutral-200 font-mono font-medium">{avgRatio.toFixed(3)}</span>
              </div>
            </div>

            <div className="w-px h-32 bg-white/10 shrink-0"></div>

            <div className="space-y-3 min-w-[180px]">
              <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-4">Distribution</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span className="text-neutral-300">Active</span></div>
                  <span className="text-emerald-400 font-mono font-medium">{counts.active}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-neutral-500"></span><span className="text-neutral-300">Complete</span></div>
                  <span className="text-neutral-400 font-mono font-medium">{counts.complete}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span><span className="text-neutral-300">Queued</span></div>
                  <span className="text-orange-400 font-mono font-medium">{counts.waiting}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span><span className="text-neutral-300">Error</span></div>
                  <span className="text-red-400 font-mono font-medium">{counts.error}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span><span className="text-neutral-300">Paused</span></div>
                  <span className="text-blue-400 font-mono font-medium">{counts.paused}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-6">
        {/* Expand / collapse toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors shrink-0"
          title={expanded ? 'Collapse graph' : 'Expand graph'}
        >
          <Activity size={14} className={isActive ? 'text-emerald-400' : 'text-neutral-500'} />
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Download speed */}
        <div className="flex items-center gap-2 min-w-[90px]">
          <Download size={13} className="text-emerald-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-emerald-300">{formatBytes(dl)}/s</span>
        </div>

        {/* Upload speed */}
        <div className="flex items-center gap-2 min-w-[90px]">
          <Upload size={13} className="text-blue-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-blue-300">{formatBytes(ul)}/s</span>
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Active torrents */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-600'}`} />
          <span className="font-semibold text-neutral-200">{active}</span>
          <span>active</span>
          {waiting > 0 && (
            <span className="text-neutral-500 ml-0.5">· {waiting} queued</span>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Active mules */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <Server size={12} className="shrink-0 text-neutral-500" />
          <span className="font-semibold text-neutral-200">{mules}</span>
          <span>mule{mules === 1 ? '' : 's'}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Subtle label */}
        <span className="text-[10px] text-neutral-600 font-mono select-none hidden sm:block">
          Smuggler
        </span>
      </div>
    </footer>
  );
}
