import { useCallback, useMemo, useState } from 'react';
import { MulesPage } from './pages/MulesPage';
import { TorrentsPage } from './pages/TorrentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ConfigsPage } from './pages/ConfigsPage';
import { StatusFooter } from './components/StatusFooter';
import { NotificationBell } from './components/NotificationBell';
import { NotificationProvider } from './context/NotificationContext';
import { DeploymentProvider } from './context/DeploymentContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { UiActionsContext } from './context/UiActionsContext';
import { TorrentDropZone } from './components/TorrentDropZone';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { AddTorrentModal } from './components/AddTorrentModal';
import { DeployMuleModal } from './components/DeployMuleModal';
import { useHashRoute } from './hooks/useHashRoute';
import { useKeyboardShortcuts, type Shortcut } from './hooks/useKeyboardShortcuts';
import { PAGES, type Page } from './lib/router';
import {
  LayoutDashboard, Server, Settings, FileKey2, Command, Sun, Moon, Monitor,
} from 'lucide-react';

const TAB_ICONS: Record<Page, React.ReactNode> = {
  torrents: <LayoutDashboard size={16} />,
  mules: <Server size={16} />,
  configs: <FileKey2 size={16} />,
  settings: <Settings size={16} />,
};

const TAB_LABELS: Record<Page, string> = {
  torrents: 'Torrents',
  mules: 'Mules',
  configs: 'Configs',
  settings: 'Settings',
};

function ThemeToggle() {
  const { preference, cycle } = useTheme();
  const icon =
    preference === 'light' ? <Sun size={16} /> :
    preference === 'dark' ? <Moon size={16} /> : <Monitor size={16} />;
  return (
    <button
      onClick={cycle}
      title={`Theme: ${preference} (click to change)`}
      aria-label={`Theme: ${preference}. Activate to change.`}
      className="p-2 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-white/5 transition-colors"
    >
      {icon}
    </button>
  );
}

function Shell() {
  const [page, navigate] = useHashRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addTorrentOpen, setAddTorrentOpen] = useState(false);
  const [deployMuleOpen, setDeployMuleOpen] = useState(false);

  const openAddTorrent = useCallback(() => setAddTorrentOpen(true), []);
  const openDeployMule = useCallback(() => setDeployMuleOpen(true), []);
  const uiActions = useMemo(
    () => ({ openAddTorrent, openDeployMule }),
    [openAddTorrent, openDeployMule],
  );

  const shortcuts: Shortcut[] = useMemo(() => [
    { key: 'k', mod: true, run: () => setPaletteOpen(o => !o) },
    { key: 'n', run: openAddTorrent },
    {
      key: '/',
      run: () => {
        // Focus the torrents search, navigating there first if needed.
        if (page !== 'torrents') navigate('torrents');
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(
            'input[aria-label="Search torrents by name or mule"]',
          )?.focus();
        });
      },
    },
  ], [page, navigate, openAddTorrent]);

  useKeyboardShortcuts(shortcuts);

  return (
    <UiActionsContext.Provider value={uiActions}>
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

          <nav className="flex gap-2" aria-label="Primary">
            {PAGES.map(key => (
              <a
                key={key}
                href={`#/${key}`}
                aria-current={page === key ? 'page' : undefined}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  page === key
                    ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                {TAB_ICONS[key]} {TAB_LABELS[key]}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPaletteOpen(true)}
              title="Command palette (Ctrl+K)"
              aria-label="Open command palette"
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-white/5 transition-colors"
            >
              <Command size={14} />
              <kbd className="text-[10px] font-mono border border-white/10 rounded px-1.5 py-0.5">Ctrl K</kbd>
            </button>
            <ThemeToggle />
            <NotificationBell />
          </div>
        </div>
      </header>

      {/* Page content — pb-14 to clear the fixed footer */}
      <main className="flex-1 w-full max-w-7xl mx-auto pb-14">
        {/* Keyed by page so switching tabs clears a previous page's error. */}
        <ErrorBoundary key={page}>
          {page === 'torrents' && <TorrentsPage />}
          {page === 'mules'    && <MulesPage />}
          {page === 'configs'  && <ConfigsPage />}
          {page === 'settings' && <SettingsPage />}
        </ErrorBoundary>
      </main>

      {/* Persistent status bar + graph footer */}
      <StatusFooter />

      {/* Window-wide .torrent drop target */}
      <TorrentDropZone />

      {/* Shell-owned modals, so the palette can open them from any page */}
      {addTorrentOpen && <AddTorrentModal onClose={() => setAddTorrentOpen(false)} />}
      {deployMuleOpen && <DeployMuleModal onClose={() => setDeployMuleOpen(false)} />}

      {paletteOpen && <CommandPalette
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        onAddTorrent={openAddTorrent}
        onDeployMule={openDeployMule}
      />}
    </div>
    </UiActionsContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <DeploymentProvider>
          <Shell />
        </DeploymentProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}
