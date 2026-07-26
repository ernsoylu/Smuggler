import { describe, it, expect } from 'vitest';
import { toBytesPerSecond, splitSpeed, isUnlimited, isSpeedUnit, SPEED_UNITS } from './speed';

describe('toBytesPerSecond', () => {
  it('converts each unit', () => {
    expect(toBytesPerSecond(500, 'B/s')).toBe(500);
    expect(toBytesPerSecond(5, 'KB/s')).toBe(5120);
    expect(toBytesPerSecond(5, 'MB/s')).toBe(5_242_880);
  });

  it('rounds to whole bytes — aria2 rejects a float', () => {
    expect(toBytesPerSecond(1.5, 'KB/s')).toBe(1536);
    expect(toBytesPerSecond(0.3, 'KB/s')).toBe(307);
    expect(Number.isInteger(toBytesPerSecond(1.1, 'MB/s'))).toBe(true);
  });

  it('treats zero and nonsense as unlimited', () => {
    expect(toBytesPerSecond(0, 'MB/s')).toBe(0);
    expect(toBytesPerSecond(-5, 'MB/s')).toBe(0);
    expect(toBytesPerSecond(Number.NaN, 'KB/s')).toBe(0);
  });
});

describe('splitSpeed', () => {
  it('picks the largest unit that divides exactly', () => {
    expect(splitSpeed(5_242_880)).toEqual({ value: 5, unit: 'MB/s' });
    expect(splitSpeed(5120)).toEqual({ value: 5, unit: 'KB/s' });
    expect(splitSpeed(512)).toEqual({ value: 512, unit: 'B/s' });
  });

  it('prefers MB/s over an equivalent KB/s reading', () => {
    // 1 MB/s must not come back as 1024 KB/s.
    expect(splitSpeed(1_048_576)).toEqual({ value: 1, unit: 'MB/s' });
  });

  it('keeps a value that divides unevenly in B/s rather than showing a fraction', () => {
    expect(splitSpeed(1000)).toEqual({ value: 1000, unit: 'B/s' });
    expect(splitSpeed(1_000_000)).toEqual({ value: 1_000_000, unit: 'B/s' });
  });

  it('reports zero as unlimited in the base unit', () => {
    expect(splitSpeed(0)).toEqual({ value: 0, unit: 'B/s' });
    expect(splitSpeed(-1)).toEqual({ value: 0, unit: 'B/s' });
  });

  it('round-trips losslessly', () => {
    for (const stored of [0, 1, 999, 1024, 1536, 5120, 1_048_576, 5_242_880, 7_340_032]) {
      const { value, unit } = splitSpeed(stored);
      expect(toBytesPerSecond(value, unit)).toBe(stored);
    }
  });
});

describe('isUnlimited', () => {
  it('is true only for zero or less', () => {
    expect(isUnlimited(0)).toBe(true);
    expect(isUnlimited(-1)).toBe(true);
    expect(isUnlimited(1)).toBe(false);
  });
});

describe('isSpeedUnit', () => {
  it('accepts every advertised unit and nothing else', () => {
    for (const u of SPEED_UNITS) expect(isSpeedUnit(u)).toBe(true);
    expect(isSpeedUnit('GB/s')).toBe(false);
    expect(isSpeedUnit('')).toBe(false);
  });
});
