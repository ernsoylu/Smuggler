/**
 * Transfer formatting — bytes, speeds, durations — and the status colour map.
 *
 * These lived as private copies inside TorrentRow and StatusFooter, and the
 * phone card list would have made a third. They are pure, they decide what the
 * user actually reads, and they now have a home that can be tested without a
 * DOM rather than belonging to whichever component needed them first.
 */

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_024) return `${(bytesPerSec / 1_024).toFixed(0)} KB/s`;
  return bytesPerSec > 0 ? `${bytesPerSec} B/s` : '—';
}

export function formatEta(seconds: number): string {
  if (seconds < 0) return '∞';
  if (seconds === 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Mantine colour per aria2 status — badges, progress bars, accents.
 *
 * The contract, so a colour means one thing:
 *   teal   in progress          blue  finished (a positive terminal state)
 *   orange queued               gray  suspended by the user
 *   red    failed               dark  gone
 *
 * `paused` was blue, which already meant action, selection and upload, and
 * `complete` was gray, which made a finished download look disabled rather
 * than done. Swapping them makes gray mean the one genuinely inactive state
 * and gives completion a colour that reads as an achievement.
 */
export const STATUS_COLORS: Record<string, string> = {
  active: 'teal',
  waiting: 'orange',
  paused: 'gray',
  error: 'red',
  complete: 'blue',
  removed: 'dark',
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'dark';
}

/**
 * ETA as the list surfaces it: only a running torrent has a meaningful one.
 *
 * The table and the card both showed a countdown for whatever `eta` happened to
 * be on a paused or finished row, so the two had to agree by copy-paste. They
 * now agree by construction.
 */
export function displayEta(status: string, eta: number): string {
  if (status !== 'active' || eta === 0) return '—';
  return formatEta(eta);
}
