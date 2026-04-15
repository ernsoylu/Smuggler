import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllTorrents } from '../api/client';
import { TorrentRow } from '../components/TorrentRow';
import { AddTorrentModal } from '../components/AddTorrentModal';
import { Plus } from 'lucide-react';

type FilterStatus = 'all' | 'active' | 'paused' | 'complete' | 'error';

export function TorrentsPage() {
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('all');

  const { data: torrents = [], isLoading } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
    refetchInterval: 2_000,
  });

  const filtered = filter === 'all'
    ? torrents
    : torrents.filter(t => t.status === filter);

  const counts: Record<FilterStatus, number> = {
    all: torrents.length,
    active: torrents.filter(t => t.status === 'active').length,
    paused: torrents.filter(t => t.status === 'paused').length,
    complete: torrents.filter(t => t.status === 'complete').length,
    error: torrents.filter(t => t.status === 'error').length,
  };

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
        {/* Filter tabs */}
        <div className="flex p-1.5 bg-neutral-900/50 backdrop-blur-md rounded-xl border border-white/5 w-max">
          {filters.map(f => (
            <button
              key={f}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filter === f
                  ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
              }`}
              onClick={() => setFilter(f)}
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

        {/* Table container */}
        <div className="bg-neutral-900/30 backdrop-blur-sm rounded-2xl border border-white/5 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-neutral-400 uppercase bg-neutral-900/50 border-b border-white/10">
                <tr>
                  <th className="px-6 py-4 font-semibold tracking-wider">Name</th>
                  <th className="px-4 py-4 font-semibold tracking-wider">Status</th>
                  <th className="px-4 py-4 font-semibold tracking-wider">Progress</th>
                  <th className="px-4 py-4 font-semibold tracking-wider text-right">Speed</th>
                  <th className="px-4 py-4 font-semibold tracking-wider text-center">Peers</th>
                  <th className="px-4 py-4 font-semibold tracking-wider">Mule</th>
                  <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/20">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-neutral-500">
                      <div className="flex items-center justify-center gap-3">
                         <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                         Loading torrents...
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                       <p className="text-neutral-400 font-medium">
                         {filter === 'all' ? 'No torrents are currently added.' : `No ${filter} torrents found.`}
                       </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map(t => <TorrentRow key={`${t.worker}:${t.gid}`} torrent={t} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && <AddTorrentModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
