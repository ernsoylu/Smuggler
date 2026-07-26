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
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(2px)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          padding: '32px 40px', borderRadius: 24,
          border: '2px dashed var(--mantine-color-blue-5)',
          background: 'var(--mantine-color-body)',
        }}
      >
        <UploadCloud
          size={40}
          color="var(--mantine-color-blue-4)"
          className={upload.isPending ? 'smuggler-pulse' : undefined}
        />
        {upload.isPending ? (
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--mantine-color-text)' }}>
            Adding torrent…
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--mantine-color-text)' }}>
              Drop .torrent files to add
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
              {target
                ? <>Will be routed to{' '}
                    <span style={{ fontFamily: 'var(--mantine-font-family-monospace)', color: 'var(--mantine-color-text)' }}>
                      {target.name}
                    </span>{' '}(least loaded)</>
                : <span style={{ color: 'var(--mantine-color-orange-4)' }}>No running mule — deploy one first</span>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
