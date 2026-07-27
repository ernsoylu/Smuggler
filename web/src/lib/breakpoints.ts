/**
 * Breakpoint media queries, mirroring Mantine's default scale.
 *
 * Most responsive switching in this app is CSS — `visibleFrom` / `hiddenFrom`
 * render both branches and let the stylesheet hide one. That is the right tool
 * for chrome, and the wrong one for anything expensive or duplicated: mounting
 * the torrent table *and* the card list would double every row's mutations and
 * queries, and put two elements with the same accessible name in the tree.
 *
 * Those cases branch in JS instead, via `useBelow`, and read their thresholds
 * from here so a JS branch and a CSS one can never disagree about where `sm`
 * is. The values are Mantine's own (`DEFAULT_THEME.breakpoints`); `below` is
 * the exact complement of `visibleFrom`, so no width falls through both.
 */

export const BREAKPOINTS = {
  xs: 36,
  sm: 48,
  md: 62,
  lg: 75,
  xl: 88,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** One CSS pixel at the default root size, in em — the gap `below` leaves. */
const EPSILON = 0.0625;

/** Matches every width strictly narrower than `breakpoint`. */
export function below(breakpoint: Breakpoint): string {
  return `(max-width: ${BREAKPOINTS[breakpoint] - EPSILON}em)`;
}

/** Matches `breakpoint` and everything wider — what `visibleFrom` uses. */
export function atLeast(breakpoint: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[breakpoint]}em)`;
}
