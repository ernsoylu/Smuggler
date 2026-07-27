import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeUiActions } from '../test/render';
import { makeTorrent, makeMule } from '../test/fixtures';

vi.mock('../api/client', () => ({
  getMules: vi.fn(),
  getAllTorrents: vi.fn(),
  addMagnet: vi.fn().mockResolvedValue({ gid: 'new' }),
  addTorrentFile: vi.fn().mockResolvedValue({ gid: 'new' }),
}));

const client = await import('../api/client');
const { AddTorrentModal } = await import('./AddTorrentModal');

/** mule-busy carries two torrents; mule-idle carries none. */
const setup = ({ running = true } = {}) => {
  vi.mocked(client.getMules).mockResolvedValue(
    running
      ? [makeMule({ name: 'mule-busy' }), makeMule({ name: 'mule-idle' })]
      : [makeMule({ name: 'mule-off', status: 'exited' })],
  );
  vi.mocked(client.getAllTorrents).mockResolvedValue([
    makeTorrent({ gid: '1', mule: 'mule-busy' }),
    makeTorrent({ gid: '2', mule: 'mule-busy' }),
  ]);
};

// Mantine Select renders a label plus a readonly combobox input, so
// getByLabelText is ambiguous — query the combobox by role.
const muleSelect = () => screen.getByRole('combobox', { name: /routing mule/i });
const submit = () => screen.getByRole('button', { name: /^add torrent$/i });

beforeEach(() => vi.clearAllMocks());

describe('AddTorrentModal routing', () => {
  it('defaults to auto-routing and names the mule it would pick', async () => {
    setup();
    renderWithProviders(<AddTorrentModal onClose={vi.fn()} />);

    // Dropping a .torrent already routes automatically; the button path used to
    // demand the one decision a user cannot make well.
    await waitFor(() =>
      expect(muleSelect()).toHaveValue('Auto — least loaded (mule-idle)'),
    );
  });

  it('sends an auto-routed magnet to the least loaded mule', async () => {
    setup();
    const onClose = vi.fn();
    renderWithProviders(<AddTorrentModal onClose={onClose} />);

    await waitFor(() => expect(submit()).toBeEnabled());
    await userEvent.type(screen.getByLabelText(/magnet uri/i), 'magnet:?xt=urn:btih:abc');
    await userEvent.click(submit());

    await waitFor(() =>
      expect(client.addMagnet).toHaveBeenCalledWith('mule-idle', 'magnet:?xt=urn:btih:abc'),
    );
    expect(onClose).toHaveBeenCalled();
  });

  /*
   * The manual-override branch is covered by resolveRoutingTarget's unit tests
   * rather than here: driving Mantine's Combobox needs real layout that jsdom
   * does not provide, so a UI-level version of this case would be asserting
   * Mantine's dropdown, not Smuggler's routing.
   */

  it('rejects an empty magnet rather than posting it', async () => {
    setup();
    renderWithProviders(<AddTorrentModal onClose={vi.fn()} />);

    await waitFor(() => expect(submit()).toBeEnabled());
    await userEvent.click(submit());

    expect(await screen.findByText(/paste a magnet link/i)).toBeInTheDocument();
    expect(client.addMagnet).not.toHaveBeenCalled();
  });
});

describe('AddTorrentModal with no running mule', () => {
  it('cannot submit', async () => {
    setup({ running: false });
    renderWithProviders(<AddTorrentModal onClose={vi.fn()} />);
    await waitFor(() => expect(submit()).toBeDisabled());
  });

  it('offers to deploy one instead of only saying to', async () => {
    setup({ running: false });
    const onClose = vi.fn();
    const uiActions = makeUiActions();
    renderWithProviders(<AddTorrentModal onClose={onClose} />, { uiActions });

    const deploy = await screen.findByRole('button', { name: /deploy one/i });
    await userEvent.click(deploy);

    // Closes itself first — two stacked modals would fight over the focus trap.
    expect(onClose).toHaveBeenCalled();
    expect(uiActions.openDeployMule).toHaveBeenCalled();
  });
});
