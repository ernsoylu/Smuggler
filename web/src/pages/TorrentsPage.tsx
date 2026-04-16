import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllTorrents, getStats } from '../api/client';
import { TorrentRow } from '../components/TorrentRow';
import { AddTorrentModal } from '../components/AddTorrentModal';
import { Plus, TrendingDown, TrendingUp, BarChart3, Layers } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

type FilterStatus = 'all' | 'active' | 'paused' | 'complete' | 'error';

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const STATUS_COLORS: Record<string, string> = {
  active:   '#10b981',
  waiting:  '#f97316',
  paused:   '#3b82f6',
  complete: '#6b7280',
  error:    '#ef4444',
};

export function TorrentsPage() {
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('all');

  const { data: torrents = [], isLoading } = useQuery({
    queryKey: ['torrents'],
    queryFn: getAllTorrents,
    refetchInterval: 2_000,
  });

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
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

  const waitingCount = torrents.filter(t => t.status === 'waiting').length;

  const statusDistribution = [
    { name: 'Active',   value: counts.active,   color: STATUS_COLORS.active },
    { name: 'Queued',   value: waitingCount,     color: STATUS_COLORS.waiting },
    { name: 'Paused',   value: counts.paused,    color: STATUS_COLORS.paused },
    { name: 'Complete', value: counts.complete,  color: STATUS_COLORS.complete },
    { name: 'Error',    value: counts.error,     color: STATUS_COLORS.error },
  ].filter(d => d.value > 0);

  const totalDownloaded = torrents.reduce((sum, t) => sum + t.completed_length, 0);
  const totalUploaded   = torrents.reduce((sum, t) => sum + t.uploaded_length, 0);
  const avgRatio = torrents.length > 0
    ? (torrents.reduce((sum, t) => sum + t.ratio, 0) / torrents.length)
    : 0;

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
                  <th className="px-4 py-4 font-semibold tracking-wider text-right">ETA</th>
                  <th className="px-4 py-4 font-semibold tracking-wider text-right">Speed</th>
                  <th className="px-4 py-4 font-semibold tracking-wider text-center">Seeds / Peers</th>
                  <th className="px-4 py-4 font-semibold tracking-wider text-right">Ratio</th>
                  <th className="px-4 py-4 font-semibold tracking-wider">Mule</th>
                  <th className="px-6 py-4 font-semibold tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950/20">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-neutral-500">
                      <div className="flex items-center justify-center gap-3">
                         <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                         Loading torrents...
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
                       <p className="text-neutral-400 font-medium">
                         {filter === 'all' ? 'No torrents are currently added.' : `No ${filter} torrents found.`}
                       </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map(t => <TorrentRow key={`${t.mule}:${t.gid}`} torrent={t} />)
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Bottom Analytics ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Transfer Summary */}
          <div className="bg-neutral-900/30 backdrop-blur-sm rounded-2xl border border-white/5 shadow-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <BarChart3 size={15} className="text-neutral-400" />
              <h3 className="text-sm font-semibold text-neutral-300">Transfer Summary</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <TrendingDown size={14} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">Downloaded</p>
                    <p className="text-neutral-100 font-mono font-semibold text-sm mt-0.5">{formatBytes(totalDownloaded)}</p>
                  </div>
                </div>
              </div>
              <div className="w-full h-px bg-white/5"></div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <TrendingUp size={14} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">Uploaded</p>
                    <p className="text-neutral-100 font-mono font-semibold text-sm mt-0.5">{formatBytes(totalUploaded)}</p>
                  </div>
                </div>
              </div>
              <div className="w-full h-px bg-white/5"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg">
                  <Layers size={14} className="text-indigo-400" />
                </div>
                <div>
                  <p className="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">Avg Ratio</p>
                  <p className="text-neutral-100 font-mono font-semibold text-sm mt-0.5">{avgRatio.toFixed(3)}</p>
                </div>
              </div>
              {stats && (
                <>
                  <div className="w-full h-px bg-white/5"></div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="bg-emerald-500/5 rounded-xl px-3 py-2.5 border border-emerald-500/10 text-center">
                      <p className="text-[10px] text-emerald-500/70 uppercase tracking-wider font-semibold">Active</p>
                      <p className="text-emerald-400 font-mono font-bold text-base mt-0.5">{stats.num_active}</p>
                    </div>
                    <div className="bg-orange-500/5 rounded-xl px-3 py-2.5 border border-orange-500/10 text-center">
                      <p className="text-[10px] text-orange-500/70 uppercase tracking-wider font-semibold">Queued</p>
                      <p className="text-orange-400 font-mono font-bold text-base mt-0.5">{stats.num_waiting}</p>
                    </div>
                    <div className="bg-neutral-500/5 rounded-xl px-3 py-2.5 border border-white/5 text-center">
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">Stopped</p>
                      <p className="text-neutral-400 font-mono font-bold text-base mt-0.5">{stats.num_stopped}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Status Distribution */}
          <div className="lg:col-span-2 bg-neutral-900/30 backdrop-blur-sm rounded-2xl border border-white/5 shadow-xl p-6">
            <h3 className="text-sm font-semibold text-neutral-300 mb-1">Status Distribution</h3>
            <p className="text-[11px] text-neutral-500 mb-4">Breakdown of all torrents by current state</p>

            {torrents.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <div className="w-10 h-10 rounded-full bg-neutral-800/80 flex items-center justify-center">
                  <BarChart3 size={18} className="text-neutral-600" />
                </div>
                <p className="text-xs text-neutral-600">No torrents to display</p>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Donut chart */}
                <div className="relative shrink-0">
                  <ResponsiveContainer width={180} height={180}>
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={76}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="rgba(0,0,0,0.4)"
                        paddingAngle={2}
                      >
                        {statusDistribution.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: '#171717',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        itemStyle={{ color: '#d1d5db' }}
                        formatter={(value) => [value, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold text-white font-mono">{torrents.length}</span>
                    <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-semibold">total</span>
                  </div>
                </div>

                {/* Legend + bars */}
                <div className="flex-1 w-full space-y-3">
                  {statusDistribution.map(d => (
                    <div key={d.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }}></div>
                          <span className="text-neutral-300 font-medium">{d.name}</span>
                        </div>
                        <span className="text-neutral-300 font-mono font-semibold">
                          {d.value}
                          <span className="text-neutral-600 font-normal ml-1">
                            ({((d.value / torrents.length) * 100).toFixed(0)}%)
                          </span>
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${(d.value / torrents.length) * 100}%`,
                            background: d.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
        {/* ── End Analytics ─────────────────────────────────────────────────── */}
      </div>

      {showModal && <AddTorrentModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
