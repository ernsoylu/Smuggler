/**
 * Disk headroom for the download directory.
 *
 * `/api/stats` has returned `disk_free` and `disk_total` since the endpoint was
 * written (api/stats.py) and nothing ever displayed them — a download manager
 * that cannot tell you whether the next payload fits.
 *
 * Both fields are optional and nullable: the API reports null when the
 * configured download dir does not resolve, which must read as "unknown"
 * rather than "full".
 */

export interface DiskSummary {
  known: boolean;
  free: number;
  total: number;
  usedFraction: number;
  /** Free space is low enough to warn about. */
  low: boolean;
  /** Free space is low enough to be the reason a download will fail. */
  critical: boolean;
}

export const LOW_DISK_FRACTION = 0.1;
export const CRITICAL_DISK_FRACTION = 0.03;

export function diskSummary(
  free: number | null | undefined,
  total: number | null | undefined,
): DiskSummary {
  const known =
    typeof free === 'number' && typeof total === 'number' &&
    Number.isFinite(free) && Number.isFinite(total) && total > 0;

  if (!known) {
    return { known: false, free: 0, total: 0, usedFraction: 0, low: false, critical: false };
  }

  const f = Math.max(0, free);
  const freeFraction = f / total;
  return {
    known: true,
    free: f,
    total,
    usedFraction: Math.min(1, (total - f) / total),
    low: freeFraction < LOW_DISK_FRACTION,
    critical: freeFraction < CRITICAL_DISK_FRACTION,
  };
}
