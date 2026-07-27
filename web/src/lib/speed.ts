/**
 * Speed-limit units.
 *
 * Rate limits are stored and sent as bytes per second, and the UI asked the
 * user to type them that way — 5 MB/s meant entering 5242880. The conversion
 * lives here rather than in the inputs so the round trip (load → display →
 * edit → save) can be tested without a DOM.
 */

export const SPEED_UNITS = ['B/s', 'KB/s', 'MB/s'] as const;
export type SpeedUnit = (typeof SPEED_UNITS)[number];

const FACTOR: Record<SpeedUnit, number> = {
  'B/s': 1,
  'KB/s': 1024,
  'MB/s': 1024 * 1024,
};

export function isSpeedUnit(value: string): value is SpeedUnit {
  return (SPEED_UNITS as readonly string[]).includes(value);
}

/** Round to whole bytes: the API takes an integer, and aria2 rejects a float. */
export function toBytesPerSecond(value: number, unit: SpeedUnit): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * FACTOR[unit]);
}

/**
 * Largest unit that divides the stored value exactly, so the number shown is
 * the number the user typed and saving it back is lossless. A value that is
 * not a clean multiple (1000 B/s) stays in B/s rather than becoming
 * 0.9765625 KB/s.
 */
export function splitSpeed(bytesPerSecond: number): { value: number; unit: SpeedUnit } {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return { value: 0, unit: 'B/s' };
  }
  // Largest first, so 1 MB/s does not come back as 1024 KB/s.
  for (const unit of ['MB/s', 'KB/s'] as const) {
    if (bytesPerSecond % FACTOR[unit] === 0) {
      return { value: bytesPerSecond / FACTOR[unit], unit };
    }
  }
  return { value: bytesPerSecond, unit: 'B/s' };
}

/** True when the limit means "no limit" — aria2's convention is 0. */
export function isUnlimited(bytesPerSecond: number): boolean {
  return !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0;
}
