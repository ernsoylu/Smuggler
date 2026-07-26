import { describe, it, expect } from 'vitest';
import {
  isIncident, countIncidents, summarisePayload, oldestId, distinct,
  severityBadgeColor, SEVERITIES, emptyEventsMessage,
} from './events';
import type { AuditEvent } from '../api/types';

const ev = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1, ts: '2026-07-26 12:00:00', source: 'observer', kind: 'api_request',
  severity: 'info', mule: null, payload: null,
  ...over,
});

describe('isIncident', () => {
  it('treats a redaction as an incident, not a log line', () => {
    // CLAUDE.md is explicit: a redaction firing is an incident, not noise.
    expect(isIncident(ev({ kind: 'secret_redacted', severity: 'info' }))).toBe(true);
  });

  it('treats a kill-switch trip as an incident', () => {
    expect(isIncident(ev({ kind: 'kill_switch_triggered', severity: 'info' }))).toBe(true);
  });

  it('treats any critical event as an incident regardless of kind', () => {
    expect(isIncident(ev({ kind: 'anything', severity: 'critical' }))).toBe(true);
  });

  it('leaves ordinary traffic alone', () => {
    expect(isIncident(ev({ kind: 'api_request', severity: 'info' }))).toBe(false);
    expect(isIncident(ev({ kind: 'vpn_status_change', severity: 'warning' }))).toBe(false);
  });
});

describe('countIncidents', () => {
  it('counts only the incidents in a window', () => {
    expect(countIncidents([
      ev({ id: 1 }),
      ev({ id: 2, kind: 'secret_redacted' }),
      ev({ id: 3, severity: 'critical' }),
    ])).toBe(2);
  });

  it('is zero for an empty window', () => {
    expect(countIncidents([])).toBe(0);
  });
});

describe('summarisePayload', () => {
  it('is empty when there is no payload', () => {
    expect(summarisePayload(null)).toBe('');
    expect(summarisePayload({})).toBe('');
  });

  it('prefers a human-readable field', () => {
    expect(summarisePayload({ reason: 'exit IP matches host', code: 3 }))
      .toBe('exit IP matches host');
  });

  it('falls back to compact key=value pairs', () => {
    expect(summarisePayload({ from: 'running', to: 'exited' })).toBe('from=running to=exited');
  });

  it('renders nested values rather than [object Object]', () => {
    expect(summarisePayload({ ip: { v4: '1.2.3.4' } })).toBe('ip={"v4":"1.2.3.4"}');
  });

  it('skips null and undefined keys', () => {
    expect(summarisePayload({ a: null, b: undefined, c: 1 })).toBe('c=1');
  });

  it('clips a long value instead of flooding the row', () => {
    const out = summarisePayload({ message: 'x'.repeat(400) }, 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('oldestId', () => {
  it('finds the lowest id for backwards paging', () => {
    expect(oldestId([ev({ id: 9 }), ev({ id: 3 }), ev({ id: 7 })])).toBe(3);
  });

  it('is null when there is nothing more to page through', () => {
    expect(oldestId([])).toBeNull();
  });
});

describe('distinct', () => {
  it('lists unique sorted values present in the window', () => {
    const events = [
      ev({ source: 'watchdog' }), ev({ source: 'api' }), ev({ source: 'watchdog' }),
    ];
    expect(distinct(events, 'source')).toEqual(['api', 'watchdog']);
  });
});

describe('severityBadgeColor', () => {
  it('maps every severity to a colour', () => {
    for (const s of SEVERITIES) expect(severityBadgeColor(s)).toBeTruthy();
  });

  it('escalates error and critical to red', () => {
    expect(severityBadgeColor('error')).toBe('red');
    expect(severityBadgeColor('critical')).toBe('red');
  });
});

describe('emptyEventsMessage', () => {
  it('distinguishes an empty system from an over-narrowed filter', () => {
    expect(emptyEventsMessage(false)).toMatch(/recorded yet/i);
    expect(emptyEventsMessage(true)).toMatch(/match these filters/i);
  });
});
