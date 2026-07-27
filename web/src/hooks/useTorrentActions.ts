import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pauseTorrent, resumeTorrent, removeTorrent } from '../api/client';
import type { Torrent } from '../api/types';

/**
 * Resume / pause / remove for one torrent, plus which of them apply.
 *
 * The table row and the phone card offer the same three operations against the
 * same three endpoints. Duplicating the mutations would mean two places to keep
 * the invalidation keys and the enabled/disabled rules in step, and they would
 * drift the first time a status was added.
 */
export function useTorrentActions(torrent: Pick<Torrent, 'mule' | 'gid' | 'status'>) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['torrents'] });

  const pause = useMutation({
    mutationFn: () => pauseTorrent(torrent.mule, torrent.gid),
    onSuccess: invalidate,
  });

  const resume = useMutation({
    mutationFn: () => resumeTorrent(torrent.mule, torrent.gid),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (deleteFiles: boolean) =>
      removeTorrent(torrent.mule, torrent.gid, deleteFiles),
    onSuccess: invalidate,
  });

  return {
    pause,
    resume,
    remove,
    /** Already running or queued to run — nothing for Resume to do. */
    resumeDisabled: torrent.status === 'active' || torrent.status === 'waiting',
    /** Not running, so there is no transfer for Pause to stop. */
    pauseDisabled:
      torrent.status === 'paused' ||
      torrent.status === 'complete' ||
      torrent.status === 'error' ||
      torrent.status === 'removed',
  };
}
