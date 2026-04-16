import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMules, addMagnet, addTorrentFile } from '../api/client';
import { X, UploadCloud, Link as LinkIcon } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function AddTorrentModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'magnet' | 'file'>('magnet');
  const [magnet, setMagnet] = useState('');
  const [worker, setWorker] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: workers = [] } = useQuery({
    queryKey: ['workers'],
    queryFn: getMules,
    staleTime: 10_000,
  });

  const runningWorkers = workers.filter(w => w.status === 'running');

  const add = useMutation({
    mutationFn: async () => {
      if (!worker) throw new Error('Select a mule');
      if (mode === 'magnet') {
        if (!magnet.trim()) throw new Error('Paste a magnet link');
        return addMagnet(worker, magnet.trim());
      } else {
        if (!file) throw new Error('Choose a .torrent file');
        return addTorrentFile(worker, file);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['torrents'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        role="presentation"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        onKeyDown={e => e.key === 'Escape' && onClose()}
      />
      
      {/* Modal */}
      <div className="relative bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-xl tracking-tight">Add Torrent</h2>
          <button 
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors" 
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl bg-neutral-950 p-1 border border-white/5">
          {(['magnet', 'file'] as const).map(m => (
            <button
              key={m}
              className={`flex items-center justify-center gap-2 flex-1 text-sm font-medium py-2 rounded-lg transition-all ${
                mode === m
                  ? 'bg-neutral-800 text-white shadow shadow-black/20 ring-1 ring-white/10'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              onClick={() => { setMode(m); setError(''); }}
            >
              {m === 'magnet' ? <LinkIcon size={16}/> : <UploadCloud size={16}/>}
              {m === 'magnet' ? 'Magnet Link' : '.torrent File'}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div className="flex flex-col gap-2">
          {mode === 'magnet' ? (
            <>
              <label htmlFor="add-torrent-magnet" className="text-sm font-medium text-neutral-400">Magnet URI</label>
              <textarea
                id="add-torrent-magnet"
                className="w-full bg-neutral-950 border border-white/10 rounded-xl text-sm text-neutral-200 p-4 font-mono resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600"
                rows={4}
                placeholder="magnet:?xt=urn:btih:..."
                value={magnet}
                onChange={e => { setMagnet(e.target.value); setError(''); }}
              />
            </>
          ) : (
            <>
              <label htmlFor="add-torrent-file" className="text-sm font-medium text-neutral-400">Torrent File</label>
              <div
                role="button"
                tabIndex={0}
                className="w-full border-2 border-dashed border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5 bg-neutral-950/50 rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center gap-3"
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              >
                <div className="w-12 h-12 rounded-full bg-neutral-900 border border-white/5 flex items-center justify-center text-neutral-400">
                   <UploadCloud size={24} />
                </div>
                <input
                  id="add-torrent-file"
                  ref={fileRef}
                  type="file"
                  accept=".torrent"
                  className="hidden"
                  onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }}
                />
                {file ? (
                  <p className="text-sm font-medium text-blue-400">{file.name}</p>
                ) : (
                  <p className="text-sm text-neutral-500">Click or drag a .torrent file here</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Worker selector */}
        <div className="flex flex-col gap-2">
          <label htmlFor="add-torrent-mule" className="text-sm font-medium text-neutral-400">Routing Mule</label>
          <div className="relative">
            <select
              id="add-torrent-mule"
              className="w-full appearance-none bg-neutral-950 border border-white/10 rounded-xl text-sm text-neutral-200 p-3.5 pr-10 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium"
              value={worker}
              onChange={e => { setWorker(e.target.value); setError(''); }}
            >
              <option value="" disabled className="text-neutral-500">— select a mule —</option>
              {runningWorkers.map(w => (
                <option key={w.name} value={w.name}>
                  {w.name} {w.ip_info ? `(${w.ip_info.country})` : ''}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </div>
          {runningWorkers.length === 0 && (
            <p className="text-xs font-medium text-orange-400 mt-1 flex items-center gap-1.5">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
               No running mules — deploy one first.
            </p>
          )}
        </div>

        {error && <p className="text-sm font-medium text-red-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20">{error}</p>}

        {/* Footer */}
        <div className="flex gap-3 pt-2">
          <button
            className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold text-neutral-300 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm text-white font-bold shadow-lg shadow-blue-500/25 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            onClick={() => add.mutate()}
            disabled={add.isPending || runningWorkers.length === 0}
          >
            {add.isPending ? (
               <>
                 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                 Adding...
               </>
            ) : 'Add Torrent'}
          </button>
        </div>
      </div>
    </div>
  );
}
