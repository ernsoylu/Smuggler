import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeUiActions } from '../test/render';
import { makeConfig, makeMule } from '../test/fixtures';

vi.mock('../api/client', () => ({
  getConfigs: vi.fn(),
  getMules: vi.fn(),
}));

const { getConfigs, getMules } = await import('../api/client');
const { SetupLadder } = await import('./SetupLadder');

const mockedConfigs = vi.mocked(getConfigs);
const mockedMules = vi.mocked(getMules);

beforeEach(() => {
  vi.clearAllMocks();
  mockedConfigs.mockResolvedValue([]);
  mockedMules.mockResolvedValue([]);
});

/** The CTA for a step, found by its accessible name. */
const cta = (name: RegExp) => screen.getByRole('button', { name });

describe('SetupLadder', () => {
  it('offers only the first step when nothing is set up', async () => {
    renderWithProviders(<SetupLadder />);

    await waitFor(() => expect(cta(/upload config/i)).toBeEnabled());
    expect(cta(/deploy mule/i)).toBeDisabled();
    expect(cta(/add torrent/i)).toBeDisabled();
  });

  it('unlocks deploying once a config exists', async () => {
    mockedConfigs.mockResolvedValue([makeConfig()]);
    renderWithProviders(<SetupLadder />);

    await waitFor(() => expect(cta(/deploy mule/i)).toBeEnabled());
    // Step 1 is done, so its button is replaced by the completed state.
    expect(screen.queryByRole('button', { name: /upload config/i })).not.toBeInTheDocument();
    expect(cta(/add torrent/i)).toBeDisabled();
  });

  it('unlocks adding a torrent once a mule is running', async () => {
    mockedConfigs.mockResolvedValue([makeConfig()]);
    mockedMules.mockResolvedValue([makeMule({ status: 'running' })]);
    renderWithProviders(<SetupLadder />);

    await waitFor(() => expect(cta(/add torrent/i)).toBeEnabled());
  });

  it('does not count a stopped mule as a running one', async () => {
    mockedConfigs.mockResolvedValue([makeConfig()]);
    mockedMules.mockResolvedValue([makeMule({ status: 'exited' })]);
    renderWithProviders(<SetupLadder />);

    await waitFor(() => expect(cta(/deploy mule/i)).toBeEnabled());
    expect(cta(/add torrent/i)).toBeDisabled();
  });

  it('routes to Configs rather than describing where to go', async () => {
    const uiActions = makeUiActions();
    renderWithProviders(<SetupLadder />, { uiActions });

    await waitFor(() => expect(cta(/upload config/i)).toBeEnabled());
    await userEvent.click(cta(/upload config/i));

    expect(uiActions.navigate).toHaveBeenCalledWith('configs');
  });

  it('opens the deploy modal from step two', async () => {
    mockedConfigs.mockResolvedValue([makeConfig()]);
    const uiActions = makeUiActions();
    renderWithProviders(<SetupLadder />, { uiActions });

    await waitFor(() => expect(cta(/deploy mule/i)).toBeEnabled());
    await userEvent.click(cta(/deploy mule/i));

    expect(uiActions.openDeployMule).toHaveBeenCalledTimes(1);
  });

  it('cannot trigger a step whose prerequisite is unmet', async () => {
    const uiActions = makeUiActions();
    renderWithProviders(<SetupLadder />, { uiActions });

    await waitFor(() => expect(cta(/upload config/i)).toBeEnabled());
    await userEvent.click(cta(/deploy mule/i));

    expect(uiActions.openDeployMule).not.toHaveBeenCalled();
  });
});
