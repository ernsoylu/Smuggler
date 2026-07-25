import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllTorrents, getMules, addTorrentFile } from '../api/client';
import { leastLoadedMule } from '../lib/torrentList';
import { useNotifications } from '../context/NotificationContext';
import { UploadCloud } from 'lucide-react';

/**
 * Window-wide drop target for .torrent files.
 *
 * The Add Torrent modal already told users "Click or drag a .torrent file
 * here" while having no drop handler anywhere in the app — dragging a file in
 * simply navigated the browser away from the page. This makes the claim true,
 * and does it at the window level so a file can be dropped anywhere.
 *
 * The destination mule is chosen automatically (fewest torrents), because
 * making someone pick from a dropdown defeats the point of a drag gesture.
 */
export function TorrentDropZone() {
  const qc = useQueryClient();
  const { push } = useNotifications();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every nested element, so track depth rather
  // than toggling on each event or the overlay flickers.
  const depth = useRef(0);

  const { data: mules = [] } = useQuery({ queryKey: ['mules'], queryFn: getMules });
  const { data: torrents = [] } = useQuery({ queryKey: ['torrents'], queryFn: getAllTorrents });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const target = leastLoadedMule(mules, torrents);
      if (!target) throw new Error('No running mule to receive the torrent — deploy one first.');
      const results = await Promise.allSettled(
        files.map(f => addTorrentFile(target.name, f)),
      );
      return { target: target.name, results, files };
    },
    onSuccess: ({ target, results, files }) => {
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      if (ok > 0) {
        push({
          type: 'success',
          title: ok === 1 ? `Added ${files[0].name}` : `Added ${ok} torrents`,
          message: `Routed to ${target}.`,
        });
      }
      if (failed > 0) {
        push({
          type: 'error',
          title: `${failed} torrent${failed === 1 ? '' : 's'} failed to add`,
          message: 'The mule rejected the file. Check that it is a valid .torrent.',
        });
      }
      qc.invalidateQueries({ queryKey: ['torrents'] });
    },
    onError: (e: Error) => {
      push({ type: 'error', title: 'Could not add torrent', message: e.message });
    },
  });

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);

    const files = Array.from(e.dataTransfer?.files ?? [])
      .filter(f => f.name.toLowerCase().endsWith('.torrent'));
    if (files.length === 0) {
      if ((e.dataTransfer?.files.length ?? 0) > 0) {
        push({
          type: 'warning',
          title: 'Not a .torrent file',
          message: 'Only .torrent files can be dropped here.',
        });
      }
      return;
    }
    upload.mutate(files);
  }, [upload, push]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      // Without preventDefault the browser navigates to the dropped file.
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDrop]);

  if (!dragging && !upload.isPending) return null;

  const target = leastLoadedMule(mules, torrents);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm pointer-events-none"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 px-10 py-8 rounded-3xl border-2 border-dashed border-blue-500/50 bg-neutral-900/80">
        <UploadCloud size={40} className={`text-blue-400 ${upload.isPending ? 'animate-pulse' : ''}`} />
        {upload.isPending ? (
          <p className="text-sm font-semibold text-white">Adding torrent…</p>
        ) : (
          <>
            <p className="text-base font-bold text-white tracking-tight">Drop .torrent files to add</p>
            <p className="text-xs text-neutral-400">
              {target
                ? <>Will be routed to <span className="font-mono text-neutral-200">{target.name}</span> (least loaded)</>
                : <span className="text-orange-400">No running mule — deploy one first</span>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
