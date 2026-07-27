import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeUiActions } from '../test/render';
import { makeTorrent, makeMule } from '../test/fixtures';
import type { Torrent } from '../api/types';

vi.mock('../api/client', () => ({
  getAllTorrents: vi.fn(),
  getMules: vi.fn(),
  getConfigs: vi.fn(),
  pauseTorrent: vi.fn().mockResolvedValue(undefined),
  resumeTorrent: vi.fn().mockResolvedValue(undefined),
  removeTorrent: vi.fn().mockResolvedValue(undefined),
  getTorrentPeers: vi.fn().mockResolvedValue([]),
  getTorrentOptions: vi.fn().mockResolvedValue({}),
  setTorrentOptions: vi.fn().mockResolvedValue(undefined),
  setFileSelection: vi.fn().mockResolvedValue(undefined),
  setTorrentCategory: vi.fn().mockResolvedValue(undefined),
}));

const client = await import('../api/client');
const { TorrentsPage } = await import('./TorrentsPage');

const setup = (torrents: Torrent[], { running = true } = {}) => {
  vi.mocked(client.getAllTorrents).mockResolvedValue(torrents);
  vi.mocked(client.getMules).mockResolvedValue(
    running ? [makeMule({ name: 'mule-1', status: 'running' })] : [],
  );
  vi.mocked(client.getConfigs).mockResolvedValue([]);
};

const selectRow = async (name: RegExp) =>
  userEvent.click(await screen.findByRole('checkbox', { name }));

const bulkBar = () => screen.getByText(/\d+ selected/).closest('div')!;

beforeEach(() => vi.clearAllMocks());

describe('TorrentsPage bulk actions', () => {
  const two = [
    makeTorrent({ gid: 'a', name: 'alpha.iso' }),
    makeTorrent({ gid: 'b', name: 'beta.iso' }),
  ];

  it('confirms before removing a selection instead of firing immediately', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);

    await selectRow(/select alpha\.iso/i);
    await userEvent.click(within(bulkBar()).getByRole('button', { name: /remove/i }));

    // The regression: bulk remove used to call the API straight away, with no
    // confirmation and no delete-files option, while removing one torrent
    // opened a dialog. The batch is the dangerous one.
    expect(client.removeTorrent).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('removes every selected torrent once confirmed', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);

    await selectRow(/select alpha\.iso/i);
    await selectRow(/select beta\.iso/i);
    await userEvent.click(within(bulkBar()).getByRole('button', { name: /remove/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/remove 2 torrents/i);
    await userEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(client.removeTorrent).toHaveBeenCalledTimes(2));
    expect(client.removeTorrent).toHaveBeenCalledWith('mule-1', 'a', false);
    expect(client.removeTorrent).toHaveBeenCalledWith('mule-1', 'b', false);
  });

  it('carries the delete-files choice into a bulk removal', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);

    await selectRow(/select alpha\.iso/i);
    await userEvent.click(within(bulkBar()).getByRole('button', { name: /remove/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(client.removeTorrent).toHaveBeenCalledWith('mule-1', 'a', true));
  });

  it('does not confirm for a non-destructive bulk action', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);

    await selectRow(/select alpha\.iso/i);
    await userEvent.click(within(bulkBar()).getByRole('button', { name: /pause/i }));

    await waitFor(() => expect(client.pauseTorrent).toHaveBeenCalledWith('mule-1', 'a'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never acts on a selected torrent that the filter has hidden', async () => {
    setup([
      makeTorrent({ gid: 'a', name: 'alpha.iso', status: 'active' }),
      makeTorrent({ gid: 'b', name: 'beta.iso', status: 'paused' }),
    ]);
    renderWithProviders(<TorrentsPage />);

    await selectRow(/select alpha\.iso/i);
    await selectRow(/select beta\.iso/i);

    // Narrow to paused only; alpha leaves the view but stays in the Set.
    await userEvent.click(screen.getByRole('radio', { name: /paused/i }));
    await userEvent.click(within(bulkBar()).getByRole('button', { name: /pause/i }));

    await waitFor(() => expect(client.pauseTorrent).toHaveBeenCalledTimes(1));
    expect(client.pauseTorrent).toHaveBeenCalledWith('mule-1', 'b');
  });
});

describe('TorrentsPage empty states', () => {
  it('shows the setup path when no mule is running', async () => {
    setup([], { running: false });
    renderWithProviders(<TorrentsPage />);

    expect(await screen.findByText(/set up your first secure download/i)).toBeInTheDocument();
    expect(screen.queryByText(/no torrents are currently added/i)).not.toBeInTheDocument();
  });

  it('offers to add a torrent once the system is ready', async () => {
    setup([]);
    const uiActions = makeUiActions();
    renderWithProviders(<TorrentsPage />, { uiActions });

    await waitFor(() => expect(screen.queryByText(/set up your first/i)).not.toBeInTheDocument());
    const cta = screen.getAllByRole('button', { name: /add torrent/i });
    await userEvent.click(cta[cta.length - 1]);
    expect(uiActions.openAddTorrent).toHaveBeenCalled();
  });

  it('explains a search that matched nothing rather than offering setup', async () => {
    setup([makeTorrent({ name: 'alpha.iso' })], { running: false });
    renderWithProviders(<TorrentsPage />);

    await screen.findByText('alpha.iso');
    await userEvent.type(screen.getByRole('searchbox', { name: /search torrents/i }), 'zzz');

    expect(await screen.findByText(/no torrents match "zzz"/i)).toBeInTheDocument();
    // A narrowed view is not a first-run problem, even with no mule running.
    expect(screen.queryByText(/set up your first/i)).not.toBeInTheDocument();
  });

  it('explains an empty status filter rather than offering setup', async () => {
    setup([makeTorrent({ status: 'active' })], { running: false });
    renderWithProviders(<TorrentsPage />);

    await userEvent.click(screen.getByRole('radio', { name: /error/i }));

    expect(await screen.findByText(/no error torrents found/i)).toBeInTheDocument();
    expect(screen.queryByText(/set up your first/i)).not.toBeInTheDocument();
  });
});
