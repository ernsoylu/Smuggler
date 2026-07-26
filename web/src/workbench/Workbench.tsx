import { useEffect, useRef } from 'react';
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
} from 'dockview-react';
import { Button, Stack, Text } from '@mantine/core';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TorrentsPage } from '../pages/TorrentsPage';
import { MulesPage } from '../pages/MulesPage';
import { ConfigsPage } from '../pages/ConfigsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useTheme } from '../context/ThemeContext';
import { isPage, parseHash, toHash, type Page } from '../lib/router';

/**
 * Dockview workbench hosting the four app views as dockable panels.
 *
 * The URL hash stays the source of truth for "where am I": header nav and the
 * command palette write `#/<page>` exactly as before, the workbench listens for
 * hashchange and activates (re-adding if closed) the matching panel, and
 * activating a panel by clicking its tab writes the hash back. lib/router.ts
 * is unchanged — a Page and a panel id are the same string.
 */

const LAYOUT_KEY = 'smuggler.layout.v1';

export const PANEL_TITLES: Record<Page, string> = {
  torrents: 'Torrents',
  mules: 'Mules',
  configs: 'Configs',
  settings: 'Settings',
};

/** Each panel scrolls its own content; the grid itself never scrolls. */
function panel(Component: React.ComponentType) {
  return function PanelHost(_props: IDockviewPanelProps) {
    return (
      <div style={{ height: '100%', overflow: 'auto' }}>
        <ErrorBoundary>
          <Component />
        </ErrorBoundary>
      </div>
    );
  };
}

const components: Record<Page, React.FunctionComponent<IDockviewPanelProps>> = {
  torrents: panel(TorrentsPage),
  mules: panel(MulesPage),
  configs: panel(ConfigsPage),
  settings: panel(SettingsPage),
};

function Watermark(_props: IWatermarkPanelProps) {
  return (
    <Stack align="center" justify="center" h="100%" gap="xs">
      <Text c="dimmed" size="sm">All panels closed.</Text>
      <Button variant="light" size="xs" onClick={() => window.dispatchEvent(new Event('smuggler:reset-layout'))}>
        Restore default layout
      </Button>
    </Stack>
  );
}

function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'torrents', component: 'torrents', title: PANEL_TITLES.torrents });
  api.addPanel({
    id: 'mules',
    component: 'mules',
    title: PANEL_TITLES.mules,
    position: { referencePanel: 'torrents', direction: 'right' },
  });
  api.addPanel({
    id: 'configs',
    component: 'configs',
    title: PANEL_TITLES.configs,
    position: { referencePanel: 'mules', direction: 'below' },
  });
  api.addPanel({
    id: 'settings',
    component: 'settings',
    title: PANEL_TITLES.settings,
    position: { referencePanel: 'configs', direction: 'within' },
  });
  api.getPanel('torrents')?.api.setActive();
}

/** Activate a page's panel, re-adding it (as a tab) if the user closed it. */
function openPage(api: DockviewApi, page: Page): void {
  const existing = api.getPanel(page);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({ id: page, component: page, title: PANEL_TITLES[page] });
}

export function Workbench({ onApi }: Readonly<{ onApi?: (api: DockviewApi) => void }>) {
  const { resolved } = useTheme();
  const apiRef = useRef<DockviewApi | null>(null);

  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;
    onApi?.(api);

    let restored = false;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
      try {
        api.fromJSON(JSON.parse(saved));
        restored = true;
      } catch {
        localStorage.removeItem(LAYOUT_KEY);
      }
    }
    if (!restored) buildDefaultLayout(api);

    // Land on the page the URL asks for, even if that panel was closed when
    // the layout was last saved.
    openPage(api, parseHash(window.location.hash));
  };

  // Persist layout, mirror active panel to the hash, follow hash changes.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const persist = api.onDidLayoutChange(() => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
    });
    const active = api.onDidActivePanelChange(event => {
      const id = event?.panel?.id;
      if (id && isPage(id) && parseHash(window.location.hash) !== id) {
        window.location.hash = toHash(id);
      }
    });
    const onHashChange = () => openPage(api, parseHash(window.location.hash));
    const onReset = () => {
      localStorage.removeItem(LAYOUT_KEY);
      api.clear();
      buildDefaultLayout(api);
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('smuggler:reset-layout', onReset);
    return () => {
      persist.dispose();
      active.dispose();
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('smuggler:reset-layout', onReset);
    };
    // apiRef.current is set synchronously by onReady before this effect runs.
  }, []);

  return (
    <DockviewReact
      components={components}
      watermarkComponent={Watermark}
      onReady={onReady}
      theme={resolved === 'dark' ? themeDark : themeLight}
    />
  );
}
