import { describe, it, expect } from 'vitest';
import { isApplePlatform, modKeyLabel } from './platform';

describe('isApplePlatform', () => {
  it('recognises the Mac and iOS platform strings', () => {
    for (const p of ['MacIntel', 'MacPPC', 'iPhone', 'iPad', 'iPod touch']) {
      expect(isApplePlatform(p)).toBe(true);
    }
  });

  it('treats every other platform as non-Apple', () => {
    for (const p of ['Win32', 'Linux x86_64', 'Linux aarch64', 'FreeBSD amd64']) {
      expect(isApplePlatform(p)).toBe(false);
    }
  });

  it('does not match a platform that merely contains "mac"', () => {
    // Anchored, so this stays Ctrl rather than becoming ⌘.
    expect(isApplePlatform('Linux emac')).toBe(false);
  });

  it('falls back to non-Apple when the platform is unavailable', () => {
    expect(isApplePlatform(undefined)).toBe(false);
    expect(isApplePlatform('')).toBe(false);
  });
});

describe('modKeyLabel', () => {
  it('labels the modifier per platform', () => {
    expect(modKeyLabel('MacIntel')).toBe('⌘');
    expect(modKeyLabel('Linux x86_64')).toBe('Ctrl');
    expect(modKeyLabel(undefined)).toBe('Ctrl');
  });
});
