import type { Torrent, Mule } from '../api/types';

/**
 * Pure list logic for the torrents table — search, filter, sort, paginate.
 *
 * Kept out of the component so it can be tested directly: the test environment
 * is node with no DOM library, and this is where the behaviour that actually
 * matters (ordering, matching, page-clamping) lives.
 */

export type FilterStatus = 'all' | 'active' | 'paused' | 'complete' | 'error';

export type SortKey =
  | 'name' | 'status' | 'progress' | 'eta' | 'speed' | 'peers' | 'ratio' | 'mule';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Case-insensitive substring match on the torrent name or its mule. */
export function matchesSearch(torrent: Torrent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    torrent.name.toLowerCase().includes(q) ||
    torrent.mule.toLowerCase().includes(q)
  );
}

export function filterTorrents(
  torrents: Torrent[],
  status: FilterStatus,
  query: string,
  category: string = ALL_CATEGORIES,
): Torrent[] {
  return torrents.filter(
    t =>
      (status === 'all' || t.status === status) &&
      matchesCategory(t, category) &&
      matchesSearch(t, query),
  );
}

/** Sentinel for "don't filter by category" — distinct from the empty string,
 *  which is a real value meaning "uncategorised". */
export const ALL_CATEGORIES = '\u0000all';
export const UNCATEGORISED = '';

export function matchesCategory(torrent: Torrent, category: string): boolean {
  if (category === ALL_CATEGORIES) return true;
  return (torrent.category ?? '') === category;
}

/** Distinct categories present, sorted, excluding the uncategorised bucket. */
export function categoriesOf(torrents: Torrent[]): string[] {
  const set = new Set<string>();
  for (const t of torrents) {
    const c = (t.category ?? '').trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Value a column sorts on. Strings compare with localeCompare, numbers numerically. */
function sortValue(t: Torrent, key: SortKey): string | number {
  switch (key) {
    case 'name':     return t.name.toLowerCase();
    case 'status':   return t.status;
    case 'mule':     return t.mule.toLowerCase();
    case 'progress': return t.progress;
    case 'speed':    return t.download_speed;
    case 'peers':    return t.connections;
    case 'ratio':    return t.ratio;
    case 'eta':
      // -1 means "unknown" from the API. Unknown ETAs sort last in ascending
      // order rather than first, which is what a user scanning for "finishing
      // soonest" expects.
      return t.eta < 0 ? Number.MAX_SAFE_INTEGER : t.eta;
    default:         return 0;
  }
}

export function sortTorrents(torrents: Torrent[], sort: SortState | null): Torrent[] {
  if (!sort) return torrents;
  const factor = sort.direction === 'asc' ? 1 : -1;
  // Copy first: callers pass the query cache array, which must not be mutated.
  return [...torrents].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv) * factor;
    }
    return ((av as number) - (bv as number)) * factor;
  });
}

/** Next sort state when a column header is clicked. */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null; // third click clears back to API order
}

export function totalPages(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

/** Slice for *page*, clamping so a shrinking list can't strand an empty page. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Math.min(Math.max(1, page), totalPages(items.length, pageSize));
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export function statusCounts(torrents: Torrent[]): Record<FilterStatus, number> {
  return {
    all: torrents.length,
    active: torrents.filter(t => t.status === 'active').length,
    paused: torrents.filter(t => t.status === 'paused').length,
    complete: torrents.filter(t => t.status === 'complete').length,
    error: torrents.filter(t => t.status === 'error').length,
  };
}

/** Stable identity for a torrent — gid is only unique within one mule. */
export function torrentKey(t: Pick<Torrent, 'mule' | 'gid'>): string {
  return `${t.mule}:${t.gid}`;
}

/**
 * Running mule currently carrying the fewest torrents.
 *
 * Used to pick a destination for a dropped .torrent so the user is not forced
 * through a dropdown. Ties break on name for deterministic behaviour.
 */
export function leastLoadedMule(mules: Mule[], torrents: Torrent[]): Mule | null {
  const running = mules.filter(m => m.status === 'running');
  if (running.length === 0) return null;
  const load = new Map<string, number>();
  for (const m of running) load.set(m.name, 0);
  for (const t of torrents) {
    if (load.has(t.mule)) load.set(t.mule, (load.get(t.mule) ?? 0) + 1);
  }
  return running.reduce((best, m) => {
    const bl = load.get(best.name) ?? 0;
    const ml = load.get(m.name) ?? 0;
    if (ml !== bl) return ml < bl ? m : best;
    return m.name < best.name ? m : best;
  }, running[0]);
}
