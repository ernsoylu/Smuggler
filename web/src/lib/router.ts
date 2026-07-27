/**
 * Minimal hash router.
 *
 * The app had no routing at all: page state lived in useState, so nothing was
 * linkable, the back button did nothing, and a refresh always dropped you on
 * Torrents.
 *
 * Hash routing rather than react-router or the History API: there are four
 * flat pages with no params or nesting, so a router dependency would be more
 * supply chain (see Phase 5) than the problem warrants, and hashes need no
 * server rewrite rules at all. `parseHash`/`toHash` are the only places that
 * know the format, so swapping in a real router later is contained.
 */

export const PAGES = ['torrents', 'mules', 'configs', 'events', 'settings'] as const;
export type Page = (typeof PAGES)[number];
export const DEFAULT_PAGE: Page = 'torrents';

/**
 * Human name for each route.
 *
 * Three surfaces now name pages — the top tab strip, the phone tab bar and the
 * command palette — and a page called "Configs" in one and "VPN Configs" in
 * another is a page the user has to learn twice.
 */
export const PAGE_LABELS: Record<Page, string> = {
  torrents: 'Torrents',
  mules: 'Mules',
  configs: 'Configs',
  events: 'Events',
  settings: 'Settings',
};

export function isPage(value: string): value is Page {
  return (PAGES as readonly string[]).includes(value);
}

/** Page encoded in a location hash, falling back to the default. */
export function parseHash(hash: string): Page {
  const raw = hash.replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
  return isPage(raw) ? raw : DEFAULT_PAGE;
}

export function toHash(page: Page): string {
  return `#/${page}`;
}
