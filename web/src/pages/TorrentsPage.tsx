import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllTorrents, pauseTorrent, resumeTorrent, removeTorrent } from '../api/client';
import { TorrentRow } from '../components/TorrentRow';
import { AddTorrentModal } from '../components/AddTorrentModal';
import {
  filterTorrents, sortTorrents, nextSort, paginate, totalPages, statusCounts,
  torrentKey, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE,
  type FilterStatus, type SortKey, type SortState,
} from '../lib/torrentList';
import { Plus, Search, X, ArrowUp, ArrowDown, Pause, Play, Trash2 } from 'lucide-react';

const COLUMNS: { key: SortKey | null; label: string; align?: string }[] = [
  { key: 'name',     label: 'Name' },
  { key: 'status',   label: 'Status' },
  { key: 'progress', label: 'Progress' },
  { key: 'eta',      label: 'ETA',   align: 'text-right' },
  { key: 'speed',    label: 'Speed', align: 'text-right' },
  { key: 'peers',    label: 'Seeds / Peers', align: 'text-center' },
  { key: 'ratio',    label: 'Ratio', align: 'text-right' },
  { key: 'mule',     label: 'Mule' },
  { key: null,       label: 'Actions', align: 'text-right' },
];

export function TorrentsPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: torrents = [], isLoading } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
    refetchInterval: 2_000,
  });

  const counts = useMemo(() => statusCounts(torrents), [torrents]);
  const visible = useMemo(
    () => sortTorrents(filterTorrents(torrents, filter, search), sort),
    [torrents, filter, search, sort],
  );
  const pageCount = totalPages(visible.length, pageSize);
  const rows = paginate(visible, page, pageSize);

  const resetPage = () => setPage(1);
  const handleFilterChange = (f: FilterStatus) => { setFilter(f); resetPage(); };
  const handleSearch = (q: string) => { setSearch(q); resetPage(); };
  const handleSort = (key: SortKey) => { setSort(s => nextSort(s, key)); resetPage(); };
  const handlePageSize = (n: number) => { setPageSize(n); resetPage(); };

  // ── Bulk selection ──────────────────────────────────────────────────────────
  // Selection is keyed by mule:gid and intersected with what is currently
  // visible, so a torrent that finishes and drops out of the filter cannot be
  // silently acted on by a later bulk operation.
  const selectedVisible = useMemo(
    () => visible.filter(t => selected.has(torrentKey(t))),
    [visible, selected],
  );
  const allPageSelected = rows.length > 0 && rows.every(t => selected.has(torrentKey(t)));

  const toggleOne = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const togglePage = () =>
    setSelected(prev => {
      const next = new Set(prev);
      for (const t of rows) {
        const k = torrentKey(t);
        if (allPageSelected) next.delete(k); else next.add(k);
      }
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const bulk = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'delete') => {
      const targets = selectedVisible;
      // Settled, not all: one failing torrent should not abandon the rest.
      await Promise.allSettled(
        targets.map(t => {
          if (action === 'pause') return pauseTorrent(t.mule, t.gid);
          if (action === 'resume') return resumeTorrent(t.mule, t.gid);
          return removeTorrent(t.mule, t.gid, false);
        }),
      );
    },
    onSettled: () => {
      clearSelection();
      qc.invalidateQueries({ queryKey: ['torrents'] });
    },
  });

  const filters: FilterStatus[] = ['all', 'active', 'paused', 'complete', 'error'];

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Torrents</h1>
          <p className="text-neutral-400 text-sm mt-1">Manage active downloads across all routing mules.</p>
        </div>
        <button
          className="flex items-center gap-2 py-2 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-sm text-white font-semibold shadow-lg shadow-blue-500/20 transition-all active:scale-95"
          onClick={() => setShowModal(true)}
        >
          <Plus size={18} strokeWidth={2.5}/> Add Torrent
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {/* Filters + search */}
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex p-1.5 bg-neutral-900/50 backdrop-blur-md rounded-xl border border-white/5 w-max">
            {filters.map(f => (
              <button
                key={f}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  filter === f
                    ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
                onClick={() => handleFilterChange(f)}
              >
                <span className="capitalize">{f}</span>
                {counts[f] > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] uppercase font-bold leading-none ${filter === f ? 'bg-white/15 text-white' : 'bg-neutral-800 text-neutral-500'}`}>
                    {counts[f]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="relative md:ml-auto w-full md:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              type="search"
              aria-label="Search torrents by name or mule"
              placeholder="Search name or mule…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="w-full bg-neutral-900/50 border border-white/5 rounded-xl text-sm text-neutral-200 py-2 pl-9 pr-9 placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
            />
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => handleSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-neutral-500 hover:text-neutral-200 hover:bg-white/10 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Bulk action bar — only present when something is selected */}
        {selectedVisible.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <span className="text-sm font-semibold text-blue-300">
              {selectedVisible.length} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => bulk.mutate('pause')}
                disabled={bulk.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-neutral-200 transition-colors disabled:opacity-40"
              >
                <Pause size={13} /> Pause
              </button>
              <button
                onClick={() => bulk.mutate('resume')}
                disabled={bulk.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-neutral-200 transition-colors disabled:opacity-40"
              >
                <Play size={13} /> Resume
              </button>
              <button
                onClick={() => bulk.mutate('delete')}
                disabled={bulk.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs font-semibold text-red-300 transition-colors disabled:opacity-40"
                title="Removes the torrents; downloaded files are kept"
              >
                <Trash2 size={13} /> Remove
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Table container */}
        <div className="bg-neutral-900/30 backdrop-blur-sm rounded-2xl border border-white/5 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-neutral-400 uppercase bg-neutral-900/50 border-b border-white/10">
                <tr>
                  <th scope="col" className="pl-6 pr-2 py-4 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all torrents on this page"
                      checked={allPageSelected}
                      onChange={togglePage}
                      disabled={rows.length === 0}
                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer disabled:opacity-30"
                    />
                  </th>
                  {COLUMNS.map(col => {
                    const active = col.key && sort?.key === col.key;
                    return (
                      <th
                        key={col.label}
                        scope="col"
                        className={`px-4 py-4 font-semibold tracking-wider ${col.align ?? ''}`}
                        aria-sort={
                          active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        {col.key ? (
                          <button
                            onClick={() => handleSort(col.key as SortKey)}
                            className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
                              active ? 'text-white' : 'hover:text-neutral-200'
                            }`}
                          >
                            {col.label}
                            {active && (sort?.direction === 'asc'
                              ? <ArrowUp size={12} />
                              : <ArrowDown size={12} />)}
                          </button>
                        ) : col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/20">
                {isLoading && (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center text-neutral-500">
                      <div className="flex items-center justify-center gap-3">
                         <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                         Loading torrents...
                      </div>
                    </td>
                  </tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center">
                       <p className="text-neutral-400 font-medium">
                         {search
                           ? `No torrents match "${search}".`
                           : filter === 'all'
                             ? 'No torrents are currently added.'
                             : `No ${filter} torrents found.`}
                       </p>
                    </td>
                  </tr>
                )}
                {!isLoading && rows.map(t => (
                  <TorrentRow
                    key={torrentKey(t)}
                    torrent={t}
                    selected={selected.has(torrentKey(t))}
                    onToggleSelected={() => toggleOne(torrentKey(t))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-white/5 bg-neutral-900/50">
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <span>
                {visible.length === 0
                  ? 'No torrents'
                  : `Showing ${(Math.min(page, pageCount) - 1) * pageSize + 1}–${Math.min(page * pageSize, visible.length)} of ${visible.length}`}
              </span>
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Torrents per page</span>
                <select
                  aria-label="Torrents per page"
                  value={pageSize}
                  onChange={e => handlePageSize(Number(e.target.value))}
                  className="bg-neutral-950 border border-white/10 rounded-lg text-xs text-neutral-300 py-1 pl-2 pr-6 focus:outline-none focus:border-blue-500/50"
                >
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </label>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-xs font-semibold rounded bg-white/5 hover:bg-white/10 text-neutral-300 disabled:opacity-30 transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs font-mono text-neutral-400 px-1">
                  {Math.min(page, pageCount)} / {pageCount}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                  className="px-3 py-1 text-xs font-semibold rounded bg-white/5 hover:bg-white/10 text-neutral-300 disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {showModal && <AddTorrentModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
