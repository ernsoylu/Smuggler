import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { removeTorrent, pauseTorrent, resumeTorrent } from '../api/client';
import type { Torrent } from '../api/types';
import { Play, Pause, Trash2, ChevronDown, ChevronRight, File as FileIcon } from 'lucide-react';

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
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const STATUS_VARIANTS: Record<string, { bg: string, text: string, ring: string, line: string }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', line: 'bg-emerald-500' },
  waiting: { bg: 'bg-orange-500/10', text: 'text-orange-400', ring: 'ring-orange-500/20', line: 'bg-orange-500' },
  paused: { bg: 'bg-blue-500/10', text: 'text-blue-400', ring: 'ring-blue-500/20', line: 'bg-blue-500' },
  error: { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20', line: 'bg-red-500' },
  complete: { bg: 'bg-neutral-500/10', text: 'text-neutral-400', ring: 'ring-neutral-500/20', line: 'bg-neutral-500' },
  removed: { bg: 'bg-neutral-800/50', text: 'text-neutral-500', ring: 'ring-transparent', line: 'bg-neutral-600' },
};

interface Props {
  torrent: Torrent;
}

export function TorrentRow({ torrent }: Props) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const pause = useMutation({
    mutationFn: () => pauseTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const resume = useMutation({
    mutationFn: () => resumeTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const remove = useMutation({
    mutationFn: () => removeTorrent(torrent.mule, torrent.gid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['torrents'] }),
  });

  const progress = Math.min(100, torrent.progress);
  const canPause = torrent.status === 'active' || torrent.status === 'waiting';
  const canResume = torrent.status === 'paused';
  const v = STATUS_VARIANTS[torrent.status] ?? STATUS_VARIANTS['removed'];

  const hasFiles = torrent.files && torrent.files.length > 0;

  return (
    <React.Fragment>
      <tr className="group hover:bg-white/[0.02] transition-colors">
        {/* Name */}
        <td className="px-6 py-4 max-w-[280px] relative">
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${v.line} opacity-0 group-hover:opacity-100 transition-opacity rounded-r-sm`}></div>
          <div className="flex items-start gap-2">
            {hasFiles ? (
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="mt-0.5 p-0.5 rounded hover:bg-white/10 text-neutral-400 transition-colors shrink-0"
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
               <div className="w-5 shrink-0" />
            )}
            <div className="flex flex-col min-w-0">
               <p className="text-sm text-neutral-100 font-medium truncate" title={torrent.name}>
                 {torrent.name || torrent.gid}
               </p>
               <p className="text-[11px] text-neutral-500 font-mono mt-1 tracking-tight truncate max-w-full">
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
        <td className="px-4 py-4 min-w-[200px]">
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

        {/* Speed */}
        <td className="px-4 py-4 whitespace-nowrap text-right">
          <div className="flex flex-col gap-0.5 text-xs font-medium">
            <span className="text-emerald-400">{formatSpeed(torrent.download_speed)} ↓</span>
            <span className="text-blue-400">{formatSpeed(torrent.upload_speed)} ↑</span>
          </div>
        </td>

        {/* Seeders / Connections */}
        <td className="px-4 py-4 whitespace-nowrap text-center">
          <div className="flex justify-center gap-1.5">
             <span className="px-2 py-0.5 bg-neutral-800/50 text-neutral-400 rounded ring-1 ring-white/5 text-xs font-mono" title="Seeders">{torrent.num_seeders}</span>
             <span className="px-2 py-0.5 bg-neutral-800/50 text-neutral-400 rounded ring-1 ring-white/5 text-xs font-mono" title="Peers">{torrent.connections}</span>
          </div>
        </td>

        {/* Worker */}
        <td className="px-4 py-4 whitespace-nowrap">
          <span className="px-2 py-1 bg-white/5 text-neutral-300 rounded text-xs font-mono ring-1 ring-white/10">
            {torrent.mule}
          </span>
        </td>

        {/* Actions */}
        <td className="px-6 py-4 whitespace-nowrap text-right">
          {showConfirm ? (
            <div className="flex justify-end gap-2 items-center">
              <span className="text-xs font-medium text-red-500 bg-red-500/10 px-2 py-1 rounded">Delete?</span>
              <button
                className="text-xs px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium"
                onClick={() => { remove.mutate(); setShowConfirm(false); }}
              >
                Yes
              </button>
              <button
                className="text-xs px-2.5 py-1 rounded-md bg-neutral-700 hover:bg-neutral-600 text-white font-medium"
                onClick={() => setShowConfirm(false)}
              >
                No
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {canPause && (
                <button
                  className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 hover:text-white text-neutral-400 transition-colors"
                  onClick={() => pause.mutate()}
                  disabled={pause.isPending}
                  title="Pause"
                >
                  <Pause size={16} />
                </button>
              )}
              {canResume && (
                <button
                  className="p-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 transition-colors"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending}
                  title="Resume"
                >
                  <Play size={16} />
                </button>
              )}
              <button
                className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                onClick={() => setShowConfirm(true)}
                title="Remove"
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </td>
      </tr>

      {/* Expanded Details + Files View */}
      {isExpanded && (
        <tr className="bg-neutral-950/40 relative">
           <td colSpan={7} className="p-0 border-t border-white/5 shadow-inner">
             <div className="px-14 py-4 max-h-[400px] overflow-y-auto custom-scrollbar space-y-4">
               
               {/* Detail metadata grid */}
               <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                 {torrent.eta >= 0 && (
                   <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                     <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">ETA</span>
                     <span className="text-neutral-200 font-mono">{formatEta(torrent.eta)}</span>
                   </div>
                 )}
                 <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                   <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Ratio</span>
                   <span className="text-neutral-200 font-mono">{torrent.ratio.toFixed(3)}</span>
                 </div>
                 <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                   <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Uploaded</span>
                   <span className="text-neutral-200 font-mono">{formatBytes(torrent.uploaded_length)}</span>
                 </div>
                 {torrent.is_seed && (
                   <div className="bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/20">
                     <span className="text-emerald-400 font-semibold">Seeding</span>
                   </div>
                 )}
                 {torrent.info_hash && (
                   <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2">
                     <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Info Hash</span>
                     <span className="text-neutral-300 font-mono text-[10px] break-all">{torrent.info_hash}</span>
                   </div>
                 )}
                 {torrent.save_path && (
                   <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2">
                     <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Save Path</span>
                     <span className="text-neutral-300 font-mono text-[10px] truncate block">{torrent.save_path}</span>
                   </div>
                 )}
                 {torrent.tracker && (
                   <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5 col-span-2">
                     <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Tracker</span>
                     <span className="text-neutral-300 font-mono text-[10px] truncate block">{torrent.tracker}</span>
                   </div>
                 )}
                 {torrent.num_pieces > 0 && (
                   <div className="bg-white/[0.03] rounded-lg px-3 py-2 border border-white/5">
                     <span className="text-neutral-500 font-semibold uppercase tracking-wider block mb-0.5">Pieces</span>
                     <span className="text-neutral-200 font-mono">{torrent.num_pieces} × {formatBytes(torrent.piece_length)}</span>
                   </div>
                 )}
                 {torrent.error_message && (
                   <div className="bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 col-span-2 md:col-span-4">
                     <span className="text-red-400 font-semibold uppercase tracking-wider block mb-0.5">Error ({torrent.error_code})</span>
                     <span className="text-red-300 text-[11px]">{torrent.error_message}</span>
                   </div>
                 )}
               </div>

               {/* Files table */}
               {hasFiles && (
               <table className="w-full text-xs text-left">
                 <thead className="text-neutral-500 font-semibold uppercase tracking-wider mb-2 block">
                   <tr>
                     <th className="w-[50px] pb-2 text-center">#</th>
                     <th className="w-[300px] pb-2">Filename</th>
                     <th className="w-[120px] pb-2 text-right">Size</th>
                     <th className="w-[200px] pb-2 pl-6">Download Progress</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-white/5 block">
                   {torrent.files.map((file) => (
                      <tr key={file.index} className={`flex items-center py-2 hover:bg-white/5 transition-colors rounded-lg px-2 ${!file.selected && 'opacity-40'}`}>
                        <td className="w-[50px] text-center text-neutral-500 font-mono">{file.index}</td>
                        <td className="w-[300px] flex items-center gap-2 truncate pr-4">
                           <FileIcon size={14} className="text-neutral-500 shrink-0" />
                           <span className="truncate text-neutral-300" title={file.name}>{file.name}</span>
                        </td>
                        <td className="w-[120px] text-right text-neutral-400 font-mono pr-6">
                           {formatBytes(file.total_length)}
                        </td>
                        <td className="w-[200px] flex flex-col gap-1 items-start justify-center">
                           <div className="flex w-full justify-between items-center text-[10px]">
                              <span className="text-neutral-500">{formatBytes(file.completed_length)}</span>
                              <span className="text-neutral-400 font-medium">{file.progress.toFixed(1)}%</span>
                           </div>
                           <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                             <div 
                               className={`h-full ${file.progress === 100 ? 'bg-neutral-500' : 'bg-blue-500'} transition-all`} 
                               style={{width: `${file.progress}%`}}
                             />
                           </div>
                        </td>
                      </tr>
                   ))}
                 </tbody>
               </table>
               )}
             </div>
           </td>
        </tr>
      )}
    </React.Fragment>
  );
}
