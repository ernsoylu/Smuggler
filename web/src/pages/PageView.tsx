import type { ComponentType } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TorrentsPage } from './TorrentsPage';
import { MulesPage } from './MulesPage';
import { ConfigsPage } from './ConfigsPage';
import { SettingsPage } from './SettingsPage';
import { EventsPage } from './EventsPage';
import type { Page } from '../lib/router';

/**
 * The single visible view, chosen by the current route.
 *
 * Replaces the Dockview workbench: one route is one full-page view, so the top
 * nav is the only way to change what is on screen and the URL always names it.
 * lib/router.ts is unchanged — a Page is still just a string.
 */

const VIEWS: Record<Page, ComponentType> = {
  torrents: TorrentsPage,
  mules: MulesPage,
  configs: ConfigsPage,
  events: EventsPage,
  settings: SettingsPage,
};

export function PageView({ page }: Readonly<{ page: Page }>) {
  const View = VIEWS[page];
  return (
    // The view scrolls itself; the shell around it never does.
    <main style={{ height: '100%', overflow: 'auto' }}>
      {/*
        Keyed by page so navigating away from a broken view clears the error.
        Each panel used to own its boundary, so a throw was contained to that
        panel; with one mount point the caught error would otherwise survive
        every later navigation and follow the user across the whole app.
      */}
      <ErrorBoundary key={page}>
        <View />
      </ErrorBoundary>
    </main>
  );
}
