import type { AuditEvent, EventSeverity } from '../api/types';

/**
 * Presentation rules for the observer's audit trail.
 *
 * Kept out of the page so the two judgements that matter — what counts as an
 * incident, and how a payload is summarised for a table row — are testable
 * without a DOM.
 */

export const SEVERITIES: EventSeverity[] = ['debug', 'info', 'warning', 'error', 'critical'];

/** Semantic colour variable per severity; see index.css. */
export function severityColor(severity: EventSeverity): string {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'var(--smg-bad)';
    case 'warning':
      return 'var(--smg-warn)';
    case 'debug':
      return 'dimmed';
    default:
      return 'var(--smg-info)';
  }
}

/** Mantine colour name per severity, for badges. */
export function severityBadgeColor(severity: EventSeverity): string {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'red';
    case 'warning':
      return 'orange';
    case 'debug':
      return 'gray';
    default:
      return 'blue';
  }
}

/**
 * Event kinds that are an incident rather than a log line.
 *
 * `secret_redacted` means the redaction filter caught something secret-shaped
 * on its way to a log. CLAUDE.md is explicit that this is to be treated as an
 * incident, not noise, so the UI must not let it scroll past as one row among
 * hundreds.
 */
export const INCIDENT_KINDS = new Set(['secret_redacted', 'kill_switch_triggered']);

export function isIncident(event: Pick<AuditEvent, 'kind' | 'severity'>): boolean {
  return INCIDENT_KINDS.has(event.kind) || event.severity === 'critical';
}

export function countIncidents(events: readonly AuditEvent[]): number {
  return events.filter(isIncident).length;
}

/**
 * One-line summary of an event payload for a table cell.
 *
 * Payload shape varies per kind, so this stays structural: prefer a short
 * message-ish field if one is present, otherwise render compact key=value
 * pairs. Long values are clipped — the full payload is one click away.
 */
export function summarisePayload(payload: AuditEvent['payload'], maxLength = 120): string {
  if (!payload || typeof payload !== 'object') return '';

  for (const key of ['reason', 'message', 'detail', 'error', 'line']) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim()) return clip(v.trim(), maxLength);
  }

  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    const rendered = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}=${rendered}`);
    if (parts.join(' ').length >= maxLength) break;
  }
  return clip(parts.join(' '), maxLength);
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

/** Oldest id in a page, for backwards pagination. Null when there is no more. */
export function oldestId(events: readonly AuditEvent[]): number | null {
  if (events.length === 0) return null;
  return events.reduce((min, e) => (e.id < min ? e.id : min), events[0].id);
}

/** Distinct values of a column present in the loaded window, sorted. */
export function distinct(events: readonly AuditEvent[], key: 'source' | 'kind'): string[] {
  return [...new Set(events.map(e => e[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Which empty state the table should show.
 *
 * An empty system and a filter narrowed to nothing are different problems: the
 * first is "nothing has happened yet", the second is "you are looking through
 * the wrong window".
 */
export function emptyEventsMessage(filtered: boolean): string {
  return filtered ? 'No events match these filters.' : 'No events recorded yet.';
}
