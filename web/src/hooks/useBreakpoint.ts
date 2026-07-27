import { useMediaQuery } from '@mantine/hooks';
import { below, type Breakpoint } from '../lib/breakpoints';

/**
 * True while the viewport is narrower than `breakpoint`.
 *
 * For chrome, prefer Mantine's `visibleFrom` / `hiddenFrom` — they cost no
 * JavaScript and cannot flash the wrong layout. Reach for this only when both
 * branches must not exist at once: the torrent list would otherwise mount the
 * table and the card list together, doubling every row's queries and putting
 * two nodes with the same accessible name in the tree.
 *
 * `getInitialValueInEffect: false` reads matchMedia during the first render
 * rather than after it. Mantine defaults to the effect because it protects
 * server rendering; this app is a client-only SPA, and deferring would mean a
 * phone painting the desktop table for one frame before swapping.
 *
 * Under jsdom the matchMedia stub answers `false` to everything, so component
 * tests all take the wide branch — which is what the existing suites assert
 * against.
 */
export function useBelow(breakpoint: Breakpoint): boolean {
  return useMediaQuery(below(breakpoint), false, { getInitialValueInEffect: false });
}
