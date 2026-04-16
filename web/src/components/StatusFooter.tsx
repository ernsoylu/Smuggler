/**
 * Persistent status bar footer — visible on all pages.
 *
 * Collapsed: shows ↓ DL / ↑ UL speeds, active torrents, active mules.
 * Expanded:  also shows the D3 SpeedGraph with rolling history.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStats } from '../api/client';
import { SpeedGraph } from './SpeedGraph';
import type { DataPoint } from './SpeedGraph';
import { ChevronUp, ChevronDown, Activity, Download, Upload, Server } from 'lucide-react';

const MAX_POINTS = 60;

function fmt(bps: number): string {
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps >= 1_024)     return `${(bps / 1_024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

export function StatusFooter() {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<DataPoint[]>([]);

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
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

  const isActive = dl > 0 || ul > 0 || active > 0;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 bg-neutral-950/90 backdrop-blur-xl border-t border-white/8 shadow-2xl shadow-black/50">
      {/* Graph panel — slides open above the bar */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? '200px' : '0px' }}
      >
        <div className="px-6 pt-4 pb-1 max-w-7xl mx-auto">
          <SpeedGraph data={history} height={140} />
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
          <span className="font-mono text-xs font-semibold text-emerald-300">{fmt(dl)}</span>
        </div>

        {/* Upload speed */}
        <div className="flex items-center gap-2 min-w-[90px]">
          <Upload size={13} className="text-blue-400 shrink-0" />
          <span className="font-mono text-xs font-semibold text-blue-300">{fmt(ul)}</span>
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
