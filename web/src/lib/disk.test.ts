import { describe, it, expect } from 'vitest';
import { diskSummary } from './disk';

const GB = 1024 ** 3;

describe('diskSummary', () => {
  it('summarises a healthy disk', () => {
    const d = diskSummary(50 * GB, 100 * GB);
    expect(d).toMatchObject({ known: true, low: false, critical: false });
    expect(d.usedFraction).toBeCloseTo(0.5);
  });

  it('warns below a tenth free', () => {
    expect(diskSummary(9 * GB, 100 * GB)).toMatchObject({ low: true, critical: false });
  });

  it('escalates below three percent free', () => {
    expect(diskSummary(1 * GB, 100 * GB)).toMatchObject({ low: true, critical: true });
  });

  it('reports unknown rather than full when the API sends null', () => {
    // The API returns null when the download dir does not resolve. Rendering
    // that as 100% used would be a false alarm.
    for (const [free, total] of [[null, null], [null, 100], [100, null]] as const) {
      const d = diskSummary(free, total);
      expect(d.known).toBe(false);
      expect(d.low).toBe(false);
      expect(d.critical).toBe(false);
    }
  });

  it('treats a zero-sized disk as unknown rather than dividing by zero', () => {
    const d = diskSummary(0, 0);
    expect(d.known).toBe(false);
    expect(Number.isNaN(d.usedFraction)).toBe(false);
  });

  it('never reports negative free space or over-full usage', () => {
    const d = diskSummary(-5, 100);
    expect(d.free).toBe(0);
    expect(d.usedFraction).toBe(1);
  });

  it('handles a completely full disk', () => {
    expect(diskSummary(0, 100 * GB)).toMatchObject({ known: true, low: true, critical: true });
  });
});
