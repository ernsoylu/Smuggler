import { describe, it, expect } from 'vitest';
import { BREAKPOINTS, below, atLeast } from './breakpoints';

describe('breakpoints', () => {
  it('mirrors Mantine\'s default scale', () => {
    // These are not ours to choose: a JS branch at `sm` and a `visibleFrom="sm"`
    // in the same layout must agree, and Mantine owns the CSS half.
    expect(BREAKPOINTS).toEqual({ xs: 36, sm: 48, md: 62, lg: 75, xl: 88 });
  });

  it('builds a max-width query that stops just short of the breakpoint', () => {
    expect(below('sm')).toBe('(max-width: 47.9375em)');
    expect(below('md')).toBe('(max-width: 61.9375em)');
  });

  it('builds a min-width query at the breakpoint itself', () => {
    expect(atLeast('sm')).toBe('(min-width: 48em)');
    expect(atLeast('md')).toBe('(min-width: 62em)');
  });

  it('leaves no width matched by both, and none matched by neither', () => {
    // The whole point: a viewport that satisfied `below` and `atLeast` would
    // mount the phone list and the table at once; one that satisfied neither
    // would show an empty page. Both bugs are a single off-by-one away.
    const parse = (query: string) => Number(/(\d+(?:\.\d+)?)em/.exec(query)![1]);

    for (const key of Object.keys(BREAKPOINTS) as (keyof typeof BREAKPOINTS)[]) {
      const max = parse(below(key));
      const min = parse(atLeast(key));
      expect(max).toBeLessThan(min);
      // Nothing can sit in the gap: it is under one CSS pixel wide.
      expect(min - max).toBeCloseTo(0.0625, 10);
    }
  });
});
