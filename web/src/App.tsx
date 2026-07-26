import { useCallback, useMemo, useRef, useState } from 'react';
import { ActionIcon, Button, Group, Kbd, MantineProvider, Text, Tooltip } from '@mantine/core';
import type { DockviewApi } from 'dockview-react';
import type { ReactNode } from 'react';
import { StatusFooter } from './components/StatusFooter';
import { NotificationBell } from './components/NotificationBell';
import { NotificationProvider } from './context/NotificationContext';
import { DeploymentProvider } from './context/DeploymentContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { UiActionsContext } from './context/UiActionsContext';
import { TorrentDropZone } from './components/TorrentDropZone';
import { CommandPalette } from './components/CommandPalette';
import { AddTorrentModal } from './components/AddTorrentModal';
import { DeployMuleModal } from './components/DeployMuleModal';
import { Workbench } from './workbench/Workbench';
import { useHashRoute } from './hooks/useHashRoute';
import { useKeyboardShortcuts, type Shortcut } from './hooks/useKeyboardShortcuts';
import { PAGES, type Page } from './lib/router';
import { theme } from './theme';
import {
  LayoutDashboard, Server, Settings, FileKey2, Command, Sun, Moon, Monitor, LayoutTemplate,
  ScrollText,
} from 'lucide-react';

const TAB_ICONS: Record<Page, ReactNode> = {
  torrents: <LayoutDashboard size={15} />,
  mules: <Server size={15} />,
  configs: <FileKey2 size={15} />,
  events: <ScrollText size={15} />,
  settings: <Settings size={15} />,
};

const TAB_LABELS: Record<Page, string> = {
  torrents: 'Torrents',
  mules: 'Mules',
  configs: 'Configs',
  events: 'Events',
  settings: 'Settings',
};

function ThemeToggle() {
  const { preference, cycle } = useTheme();
  const icon =
    preference === 'light' ? <Sun size={16} /> :
    preference === 'dark' ? <Moon size={16} /> : <Monitor size={16} />;
  return (
    <Tooltip label={`Theme: ${preference}`} withArrow>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        onClick={cycle}
        aria-label={`Theme: ${preference}. Activate to change.`}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

function Shell() {
  const [page, navigate] = useHashRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addTorrentOpen, setAddTorrentOpen] = useState(false);
  const [deployMuleOpen, setDeployMuleOpen] = useState(false);
  const dockApiRef = useRef<DockviewApi | null>(null);

  const openAddTorrent = useCallback(() => setAddTorrentOpen(true), []);
  const openDeployMule = useCallback(() => setDeployMuleOpen(true), []);
  const uiActions = useMemo(
    () => ({ openAddTorrent, openDeployMule, navigate }),
    [openAddTorrent, openDeployMule, navigate],
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
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <Group
          component="header"
          px="md"
          py={8}
          gap="lg"
          wrap="nowrap"
          style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
        >
          <Group gap="xs" wrap="nowrap" style={{ userSelect: 'none' }}>
            <div
              aria-hidden
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                background: 'linear-gradient(45deg, var(--mantine-color-smuggler-7), var(--mantine-color-smuggler-5))',
                boxShadow: '0 2px 10px rgba(249, 115, 22, .35)',
              }}
            >
              🫏
            </div>
            <Text fw={700} tt="uppercase" size="md" lts={1}>Smuggler</Text>
          </Group>

          <Group component="nav" gap={4} wrap="nowrap" aria-label="Primary">
            {PAGES.map(key => (
              <Button
                key={key}
                component="a"
                href={`#/${key}`}
                size="compact-sm"
                variant={page === key ? 'light' : 'subtle'}
                color={page === key ? 'smuggler' : 'gray'}
                leftSection={TAB_ICONS[key]}
                aria-current={page === key ? 'page' : undefined}
              >
                {TAB_LABELS[key]}
              </Button>
            ))}
          </Group>

          <Group gap={4} wrap="nowrap" ml="auto">
            <Tooltip label="Restore default layout" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="Restore default panel layout"
                onClick={() => window.dispatchEvent(new Event('smuggler:reset-layout'))}
              >
                <LayoutTemplate size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              visibleFrom="sm"
              leftSection={<Command size={14} />}
              rightSection={<Kbd size="xs">Ctrl K</Kbd>}
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
            />
            <ThemeToggle />
            <NotificationBell />
          </Group>
        </Group>

        {/* Dockable panel workbench */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <Workbench onApi={api => { dockApiRef.current = api; }} />
        </div>

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

function MantineRoot({ children }: Readonly<{ children: ReactNode }>) {
  const { resolved } = useTheme();
  return (
    <MantineProvider theme={theme} forceColorScheme={resolved}>
      {children}
    </MantineProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MantineRoot>
        <NotificationProvider>
          <DeploymentProvider>
            <Shell />
          </DeploymentProvider>
        </NotificationProvider>
      </MantineRoot>
    </ThemeProvider>
  );
}
