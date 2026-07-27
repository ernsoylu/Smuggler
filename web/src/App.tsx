import { useCallback, useMemo, useState } from 'react';
import { ActionIcon, Box, Button, Group, Kbd, MantineProvider, Text, Tooltip } from '@mantine/core';
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
import { PageView } from './pages/PageView';
import { useHashRoute } from './hooks/useHashRoute';
import { useKeyboardShortcuts, type Shortcut } from './hooks/useKeyboardShortcuts';
import { PAGES, type Page } from './lib/router';
import { modKeyLabel } from './lib/platform';
import { theme, cssVariablesResolver } from './theme';
import {
  LayoutDashboard, Server, Settings, FileKey2, Command, Sun, Moon, Monitor,
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

  // Read once: the platform does not change mid-session.
  const modKey = useMemo(() => modKeyLabel(navigator.platform), []);

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

          {/*
            Five labelled tabs plus the logo and four right-hand controls
            overflow a phone. Below `md` the labels drop and the tabs become
            icons; the accessible name comes from aria-label either way, so
            nothing is lost to a screen reader — only to pixels.
          */}
          <Group component="nav" gap={4} wrap="nowrap" aria-label="Primary">
            {PAGES.map(key => (
              <Tooltip key={key} label={TAB_LABELS[key]} withArrow hiddenFrom="md">
                <Button
                  component="a"
                  href={`#/${key}`}
                  size="compact-sm"
                  px={{ base: 8, md: 12 }}
                  variant={page === key ? 'light' : 'subtle'}
                  color={page === key ? 'smuggler' : 'gray'}
                  leftSection={TAB_ICONS[key]}
                  aria-label={TAB_LABELS[key]}
                  aria-current={page === key ? 'page' : undefined}
                  styles={{ section: { marginInlineEnd: 0 } }}
                >
                  <Box visibleFrom="md" ml={6}>{TAB_LABELS[key]}</Box>
                </Button>
              </Tooltip>
            ))}
          </Group>

          <Group gap={4} wrap="nowrap" ml="auto">
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              visibleFrom="sm"
              leftSection={<Command size={14} />}
              rightSection={<Kbd size="xs">{modKey} K</Kbd>}
              onClick={() => setPaletteOpen(true)}
              aria-label={`Open command palette (${modKey} K)`}
            />
            <ThemeToggle />
            <NotificationBell />
          </Group>
        </Group>

        {/* The routed view */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <PageView page={page} />
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
    <MantineProvider
      theme={theme}
      forceColorScheme={resolved}
      cssVariablesResolver={cssVariablesResolver}
    >
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
