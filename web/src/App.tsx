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
import { MobileTabBar } from './components/MobileTabBar';
import { PageIcon } from './components/PageIcon';
import { useHashRoute } from './hooks/useHashRoute';
import { useKeyboardShortcuts, type Shortcut } from './hooks/useKeyboardShortcuts';
import { PAGES, PAGE_LABELS } from './lib/router';
import { modKeyLabel } from './lib/platform';
import { theme, cssVariablesResolver } from './theme';
import { Command, Sun, Moon, Monitor } from 'lucide-react';

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
      {/*
        `.smuggler-shell` is 100dvh where that is supported. A phone browser's
        100vh includes the space under the collapsing address bar, so the bottom
        tab bar sat below the fold until the user scrolled — the one element
        that must never move.
      */}
      <div className="smuggler-shell" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <Group
          component="header"
          px={{ base: 'sm', sm: 'md' }}
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
                flexShrink: 0,
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
            {/* The wordmark costs ~90px a phone does not have to spare, and the
                tab bar names the app's sections anyway. */}
            <Text fw={700} tt="uppercase" size="md" lts={1} visibleFrom="sm">Smuggler</Text>
          </Group>

          {/*
            Five labelled tabs plus the logo and four right-hand controls
            overflow a phone. Below `md` the labels drop and the tabs become
            icons; below `sm` the strip goes entirely and MobileTabBar takes
            over at the bottom edge. Exactly one of the two is ever displayed,
            so "Primary" names one nav at every width.
          */}
          <Group component="nav" gap={4} wrap="nowrap" aria-label="Primary" visibleFrom="sm">
            {PAGES.map(key => (
              <Tooltip key={key} label={PAGE_LABELS[key]} withArrow hiddenFrom="md">
                <Button
                  component="a"
                  href={`#/${key}`}
                  size="compact-sm"
                  px={{ base: 8, md: 12 }}
                  variant={page === key ? 'light' : 'subtle'}
                  color={page === key ? 'smuggler' : 'gray'}
                  leftSection={<PageIcon page={key} size={15} />}
                  aria-label={PAGE_LABELS[key]}
                  aria-current={page === key ? 'page' : undefined}
                  styles={{ section: { marginInlineEnd: 0 } }}
                >
                  <Box visibleFrom="md" ml={6}>{PAGE_LABELS[key]}</Box>
                </Button>
              </Tooltip>
            ))}
          </Group>

          {/* Where the tab strip is hidden, the header says which page this is. */}
          <Text fw={600} size="sm" truncate hiddenFrom="sm">{PAGE_LABELS[page]}</Text>

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

        {/* Primary navigation below `sm` — hides itself from `sm` up */}
        <MobileTabBar page={page} />

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
