import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import type { AuditEvent } from '../api/types';

vi.mock('../api/client', () => ({ getEvents: vi.fn() }));

const client = await import('../api/client');
const { EventsPage } = await import('./EventsPage');

const ev = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1, ts: '2026-07-26 12:00:00', source: 'observer', kind: 'api_request',
  severity: 'info', mule: null, payload: null,
  ...over,
});

/*
 * Event kinds also populate the "filter by kind" options, so a bare getByText
 * matches twice. Row assertions are scoped to the table; the filters are
 * comboboxes, queried by role.
 */
const inTable = () => within(screen.getByRole('table'));

const setup = (events: AuditEvent[]) =>
  vi.mocked(client.getEvents).mockResolvedValue({ events, count: events.length });

beforeEach(() => vi.clearAllMocks());

describe('EventsPage', () => {
  it('renders the audit trail the UI previously could not reach', async () => {
    setup([ev({ id: 2, kind: 'vpn_status_change', mule: 'mule-1' })]);
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(inTable().getByText('vpn_status_change')).toBeInTheDocument());
    expect(inTable().getByText('mule-1')).toBeInTheDocument();
  });

  it('raises a redaction as an incident rather than another log row', async () => {
    // CLAUDE.md: a redaction firing is an incident, not noise.
    setup([ev({ id: 3, kind: 'secret_redacted', severity: 'info' })]);
    renderWithProviders(<EventsPage />);

    expect(await screen.findByText(/1 incident in this window/i)).toBeInTheDocument();
  });

  it('does not cry incident over ordinary traffic', async () => {
    setup([ev({ id: 4, kind: 'api_request', severity: 'info' })]);
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(inTable().getByText('api_request')).toBeInTheDocument());
    expect(screen.queryByText(/incident/i)).not.toBeInTheDocument();
  });

  it('counts every incident in the window', async () => {
    setup([
      ev({ id: 5, kind: 'secret_redacted' }),
      ev({ id: 6, kind: 'kill_switch_triggered' }),
      ev({ id: 7 }),
    ]);
    renderWithProviders(<EventsPage />);

    expect(await screen.findByText(/2 incidents in this window/i)).toBeInTheDocument();
  });

  it('shows a payload on demand rather than flooding the row', async () => {
    setup([ev({ id: 8, kind: 'secret_redacted', payload: { logger: 'cli.log', line: 42 } })]);
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(inTable().getByText('secret_redacted')).toBeInTheDocument());
    expect(screen.queryByText(/"logger"/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show payload/i }));
    expect(await screen.findByText(/"logger"/)).toBeInTheDocument();
  });

  /*
   * Choosing a filter is not driven here: Mantine's Combobox needs layout that
   * jsdom does not provide, so a UI-level version would assert Mantine's
   * dropdown rather than Smuggler's behaviour. The two halves are covered
   * where they live — emptyEventsMessage in lib/events.test.ts, and the
   * dropping of unset filters in api/client.test.ts.
   */
  it('shows the empty-system message when nothing is filtered', async () => {
    setup([]);
    renderWithProviders(<EventsPage />);
    expect(await screen.findByText(/no events recorded yet/i)).toBeInTheDocument();
  });

  it('sends no severity filter when none is chosen', async () => {
    setup([ev()]);
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(client.getEvents).toHaveBeenCalled());
    expect(client.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ severity: undefined, source: undefined, kind: undefined }),
    );
  });
});
