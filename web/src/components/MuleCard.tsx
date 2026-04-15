import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { stopMule, killMule } from '../api/client';
import type { Mule } from '../api/types';
import { Power, Trash2, Globe2, Shield, Radio, TerminalSquare } from 'lucide-react';

interface Props {
  worker: Mule;
}

export function WorkerCard({ worker }: Props) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState<'stop' | 'kill' | null>(null);

  const stop = useMutation({
    mutationFn: () => stopMule(worker.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  });

  const kill = useMutation({
    mutationFn: () => killMule(worker.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  });

  const isRunning = worker.status === 'running';
  const statusColor = isRunning ? 'bg-emerald-500' : 'bg-neutral-500';
  const statusRing = isRunning ? 'ring-emerald-500/20' : 'ring-neutral-500/20';
  const statusText = isRunning ? 'text-emerald-400' : 'text-neutral-400';
  const statusBg = isRunning ? 'bg-emerald-500/10' : 'bg-neutral-500/10';
  const ip = worker.ip_info;

  return (
    <div className="bg-neutral-900/40 backdrop-blur-sm border border-white/5 hover:border-white/10 shadow-xl rounded-2xl flex flex-col transition-all group overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5 bg-neutral-900/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3 min-w-0">
            <div className={`mt-1 w-2.5 h-2.5 rounded-full ${statusColor} shadow-[0_0_10px_rgba(0,0,0,0.5)] shadow-${statusColor.split('-')[1]}-500/50 shrink-0`} />
            <div className="min-w-0">
              <p className="font-semibold text-white tracking-tight truncate text-base">{worker.name}</p>
              <p className="text-xs text-neutral-500 font-mono tracking-tighter mt-0.5">{worker.id.slice(0, 12)}</p>
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-md font-semibold capitalize ring-1 inset-ring shrink-0 ${statusText} ${statusBg} ${statusRing}`}>
            {worker.status}
          </span>
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

      {/* Footer */}
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
