import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeUiActions } from '../test/render';
import type { MuleHealth } from '../api/types';

vi.mock('../api/client', () => ({
  getStats: vi.fn(),
  getAllTorrents: vi.fn(),
  getWatchdogStatus: vi.fn(),
}));

// D3 measures a container that jsdom gives no size; the graph is not under test.
vi.mock('./SpeedGraph', () => ({ SpeedGraph: () => null }));

const client = await import('../api/client');
const { StatusFooter } = await import('./StatusFooter');

const mule = (name: string, healthy: boolean): MuleHealth => ({
  name, healthy, ip: null, reason: healthy ? 'ok' : 'exit IP matches host',
});

const setup = (mules: MuleHealth[] | null) => {
  vi.mocked(client.getStats).mockResolvedValue({
    download_speed: 0, upload_speed: 0, num_active: 0,
    num_waiting: 0, num_stopped: 0, num_mules: mules?.length ?? 0,
  });
  vi.mocked(client.getAllTorrents).mockResolvedValue([]);
  vi.mocked(client.getWatchdogStatus).mockResolvedValue({
    config: { interval_seconds: 60, failure_threshold: 3 },
    stats: { started_at: null, last_run_at: null, total_sweeps: 1, total_evacuations: 0 },
    mules: mules ?? [],
  });
};

/*
 * Must match every string healthLabel can produce, "No mules" included.
 * Matching only /secure|compromised/ made the empty-state assertion vacuous:
 * the chip could render "No mules" and the query would still find nothing.
 */
const chip = () => screen.queryByRole('button', { name: /secure|compromised|no mules/i });

beforeEach(() => vi.clearAllMocks());

describe('StatusFooter tunnel health', () => {
  it('surfaces tunnel health, not just a mule count', async () => {
    setup([mule('a', true), mule('b', true)]);
    renderWithProviders(<StatusFooter />);

    expect(await screen.findByText('2/2 secure')).toBeInTheDocument();
  });

  it('names the compromised mule so the alarm is actionable', async () => {
    setup([mule('a', true), mule('frankfurt', false)]);
    renderWithProviders(<StatusFooter />);

    expect(await screen.findByText('frankfurt compromised')).toBeInTheDocument();
    expect(screen.queryByText(/secure/)).not.toBeInTheDocument();
  });

  it('shows nothing rather than a reassuring 0/0 when no mules exist', async () => {
    setup([]);
    renderWithProviders(<StatusFooter />);

    await waitFor(() => expect(client.getWatchdogStatus).toHaveBeenCalled());
    expect(chip()).not.toBeInTheDocument();
  });

  it('conveys state in text, not colour alone', async () => {
    setup([mule('a', false)]);
    renderWithProviders(<StatusFooter />);

    // A colourblind or screen-reader user must get the same signal.
    expect(await screen.findByText(/compromised/)).toBeInTheDocument();
  });

  it('leads to the page that can act on it', async () => {
    setup([mule('a', false)]);
    const uiActions = makeUiActions();
    renderWithProviders(<StatusFooter />, { uiActions });

    await userEvent.click(await screen.findByRole('button', { name: /compromised/i }));
    expect(uiActions.navigate).toHaveBeenCalledWith('mules');
  });
});
