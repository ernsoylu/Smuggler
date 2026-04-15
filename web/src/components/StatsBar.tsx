import type { GlobalStats } from '../api/types';
import { ArrowDownToLine, ArrowUpFromLine, Activity, Server, PauseCircle, Clock } from 'lucide-react';

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_024) return `${(bytesPerSec / 1_024).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

interface Props {
  stats: GlobalStats;
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="px-6 mt-6">
      <div className="bg-neutral-900/50 backdrop-blur-md rounded-2xl border border-white/5 shadow-xl flex flex-wrap items-center justify-between gap-6 px-6 py-4 text-sm">
        
        <div className="flex gap-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <ArrowDownToLine size={16} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-neutral-500 text-xs font-semibold uppercase tracking-wider">Download</p>
              <p className="text-neutral-100 font-mono font-medium tracking-tight text-base mt-0.5">{formatSpeed(stats.download_speed)}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <ArrowUpFromLine size={16} strokeWidth={2.5} />
            </div>
            <div>
               <p className="text-neutral-500 text-xs font-semibold uppercase tracking-wider">Upload</p>
               <p className="text-neutral-100 font-mono font-medium tracking-tight text-base mt-0.5">{formatSpeed(stats.upload_speed)}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-6 relative">
          <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-px h-8 bg-white/5"></div>
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs text-neutral-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Activity size={12}/> Active</span>
            <span className="text-emerald-400 font-mono font-medium text-base">{stats.num_active}</span>
          </span>
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs text-neutral-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><Clock size={12}/> Queued</span>
             <span className="text-orange-400 font-mono font-medium text-base">{stats.num_waiting}</span>
          </span>
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs text-neutral-500 font-semibold uppercase tracking-wider flex items-center gap-1.5"><PauseCircle size={12}/> Stopped</span>
            <span className="text-neutral-400 font-mono font-medium text-base">{stats.num_stopped}</span>
          </span>
        </div>

        <div className="flex items-center gap-3 relative">
          <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-px h-8 bg-white/5"></div>
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
             <Server size={16} />
          </div>
          <div>
            <p className="text-neutral-500 text-xs font-semibold uppercase tracking-wider">Mules</p>
             <p className="text-neutral-100 font-mono font-medium text-base mt-0.5">{stats.num_workers} <span className="text-neutral-500 text-sm">active</span></p>
          </div>
        </div>

      </div>
    </div>
  );
}
