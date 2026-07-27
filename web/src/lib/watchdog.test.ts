import { describe, it, expect } from 'vitest';
import { healthSummary, healthLabel } from './watchdog';
import type { MuleHealth, WatchdogStatus } from '../api/types';

const mule = (name: string, healthy: boolean): MuleHealth => ({
  name, healthy, ip: healthy ? '203.0.113.1' : null, reason: healthy ? 'ok' : 'exit IP matches host',
});

const status = (mules: MuleHealth[]): WatchdogStatus => ({
  config: { interval_seconds: 60, failure_threshold: 3 },
  stats: { started_at: null, last_run_at: null, total_sweeps: 1, total_evacuations: 0 },
  mules,
});

describe('healthSummary', () => {
  it('reports nothing to show before any sweep', () => {
    expect(healthSummary(undefined)).toMatchObject({ empty: true, allHealthy: false, total: 0 });
  });

  it('treats a sweep with no mules as empty, not as healthy', () => {
    // "0/0 secure" would read as reassurance about a system with no tunnels.
    expect(healthSummary(status([]))).toMatchObject({ empty: true, allHealthy: false });
  });

  it('counts an all-healthy fleet', () => {
    const s = healthSummary(status([mule('a', true), mule('b', true)]));
    expect(s).toMatchObject({ total: 2, secure: 2, compromised: 0, allHealthy: true, empty: false });
  });

  it('is not allHealthy when any mule is compromised', () => {
    const s = healthSummary(status([mule('a', true), mule('b', false)]));
    expect(s).toMatchObject({ total: 2, secure: 1, compromised: 1, allHealthy: false });
    expect(s.firstCompromised).toBe('b');
  });

  it('names a compromised mule even when it is the only one', () => {
    expect(healthSummary(status([mule('solo', false)])).firstCompromised).toBe('solo');
  });
});

describe('healthLabel', () => {
  it('shows the secure ratio when all is well', () => {
    expect(healthLabel(healthSummary(status([mule('a', true), mule('b', true)])))).toBe('2/2 secure');
  });

  it('names the mule when exactly one is compromised', () => {
    expect(healthLabel(healthSummary(status([mule('a', true), mule('b', false)]))))
      .toBe('b compromised');
  });

  it('falls back to a count past one failure', () => {
    expect(healthLabel(healthSummary(status([mule('a', false), mule('b', false)]))))
      .toBe('2 compromised');
  });

  it('says so when there are no mules', () => {
    expect(healthLabel(healthSummary(status([])))).toBe('No mules');
  });
});
