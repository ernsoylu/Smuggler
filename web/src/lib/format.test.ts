import { describe, it, expect } from 'vitest';
import {
  formatBytes, formatSpeed, formatEta, statusColor, displayEta,
} from './format';

describe('formatBytes', () => {
  it('keeps small values in bytes rather than rounding them to 0 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('steps up a unit exactly at the boundary, not past it', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1_048_576)).toBe('1.0 MB');
    expect(formatBytes(1_073_741_824)).toBe('1.00 GB');
  });

  it('gains precision with magnitude, so a GB reading stays useful', () => {
    // 40 GB free and 40.75 GB free are different answers to "does it fit".
    expect(formatBytes(43_751_178_567)).toBe('40.75 GB');
  });
});

describe('formatSpeed', () => {
  it('reads idle as a dash, not as 0 B/s', () => {
    expect(formatSpeed(0)).toBe('—');
  });

  it('scales through the units', () => {
    expect(formatSpeed(900)).toBe('900 B/s');
    expect(formatSpeed(2048)).toBe('2 KB/s');
    expect(formatSpeed(11_744_051)).toBe('11.2 MB/s');
  });
});

describe('formatEta', () => {
  it('marks an unknown ETA as unbounded rather than negative', () => {
    // The API sends -1 when it cannot estimate; "-1s" would read as a number.
    expect(formatEta(-1)).toBe('∞');
  });

  it('shows nothing to wait for as a dash', () => {
    expect(formatEta(0)).toBe('—');
  });

  it('breaks into the largest two units that fit', () => {
    expect(formatEta(45)).toBe('45s');
    expect(formatEta(252)).toBe('4m 12s');
    expect(formatEta(7_380)).toBe('2h 3m');
  });
});

describe('displayEta', () => {
  it('counts down only while the torrent is running', () => {
    expect(displayEta('active', 252)).toBe('4m 12s');
  });

  it('refuses to show a stale countdown on a stopped torrent', () => {
    // A paused row keeps whatever eta it had; rendering it implies progress.
    expect(displayEta('paused', 500)).toBe('—');
    expect(displayEta('complete', 500)).toBe('—');
    expect(displayEta('error', 500)).toBe('—');
  });

  it('shows a dash when an active torrent has no estimate yet', () => {
    expect(displayEta('active', 0)).toBe('—');
  });
});

describe('statusColor', () => {
  it('keeps the contract: one colour, one meaning', () => {
    expect(statusColor('active')).toBe('teal');
    expect(statusColor('complete')).toBe('blue');
    expect(statusColor('waiting')).toBe('orange');
    expect(statusColor('paused')).toBe('gray');
    expect(statusColor('error')).toBe('red');
  });

  it('falls back rather than rendering an undefined Mantine colour', () => {
    expect(statusColor('something-aria2-invented')).toBe('dark');
  });
});
