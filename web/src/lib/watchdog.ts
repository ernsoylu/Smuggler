import type { WatchdogStatus } from '../api/types';

/**
 * Condenses a watchdog sweep into the one line the status bar can show.
 *
 * The watchdog panel lives on the Mules page only, so a tunnel could be
 * reported compromised while the user watched Torrents and the ambient UI
 * stayed calm. The footer is the one element always on screen, and mule *count*
 * was the only mule fact it carried.
 */

export interface HealthSummary {
  total: number;
  secure: number;
  compromised: number;
  /** Name of a compromised mule, for the single-failure case. Null otherwise. */
  firstCompromised: string | null;
  allHealthy: boolean;
  /** Nothing to report on — no mules deployed, or no sweep yet. */
  empty: boolean;
}

export function healthSummary(watchdog: WatchdogStatus | undefined): HealthSummary {
  const mules = watchdog?.mules ?? [];
  const compromised = mules.filter(m => !m.healthy);
  return {
    total: mules.length,
    secure: mules.length - compromised.length,
    compromised: compromised.length,
    firstCompromised: compromised[0]?.name ?? null,
    allHealthy: mules.length > 0 && compromised.length === 0,
    empty: mules.length === 0,
  };
}

/**
 * Status-bar label. Names the mule when exactly one is compromised — with a
 * single failure the name is the actionable part, and past that a count is all
 * that fits.
 */
export function healthLabel(s: HealthSummary): string {
  if (s.empty) return 'No mules';
  if (s.compromised === 0) return `${s.secure}/${s.total} secure`;
  if (s.compromised === 1 && s.firstCompromised) return `${s.firstCompromised} compromised`;
  return `${s.compromised} compromised`;
}
