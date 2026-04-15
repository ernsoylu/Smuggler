import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStats } from './api/client';
import { StatsBar } from './components/StatsBar';
import { SpeedGraph } from './components/SpeedGraph';
import { WorkersPage } from './pages/WorkersPage';
import { TorrentsPage } from './pages/TorrentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ConfigsPage } from './pages/ConfigsPage';
import { LayoutDashboard, Server, Settings, FileKey2 } from 'lucide-react';

type Page = 'torrents' | 'workers' | 'configs' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('torrents');

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 2_000,
  });

  const showStatsGraph = page === 'torrents' || page === 'workers';

  const tabs: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: 'torrents', label: 'Torrents', icon: <LayoutDashboard size={16} /> },
    { key: 'workers', label: 'Mules', icon: <Server size={16} /> },
    { key: 'configs', label: 'Configs', icon: <FileKey2 size={16} /> },
    { key: 'settings', label: 'Settings', icon: <Settings size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col font-sans selection:bg-blue-500/30">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-neutral-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-8 px-6 py-3.5 max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3 select-none cursor-pointer group">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40 transition-shadow text-base leading-none">
              🫏
            </div>
            <span className="text-white font-bold text-lg tracking-wide uppercase bg-clip-text text-transparent bg-gradient-to-r from-white to-neutral-400">
              Smuggler
            </span>
          </div>
          
          <nav className="flex gap-2">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setPage(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  page === tab.key
                    ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Stats bar & Speed graph */}
      {showStatsGraph && (
        <>
          <div className="max-w-7xl mx-auto w-full">
            {stats && <StatsBar stats={stats} />}
          </div>
          <div className="px-6 pt-6 pb-0 max-w-7xl mx-auto w-full">
            <SpeedGraph stats={stats} />
          </div>
        </>
      )}

      {/* Page content */}
      <main className="flex-1 w-full max-w-7xl mx-auto">
        {page === 'torrents' && <TorrentsPage />}
        {page === 'workers' && <WorkersPage />}
        {page === 'configs' && <ConfigsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
