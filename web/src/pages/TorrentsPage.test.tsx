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

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

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

describe('TorrentsPage list ergonomics', () => {
  const two = [
    makeTorrent({ gid: 'a', name: 'alpha.iso', download_speed: 100 }),
    makeTorrent({ gid: 'b', name: 'beta.iso', download_speed: 900 }),
  ];

  it('holds the row order still while a selection exists', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);
    await screen.findByText('alpha.iso');

    // Sort by speed so the order is data-driven and would move on refetch.
    await userEvent.click(screen.getByRole('button', { name: /speed/i }));
    const before = screen.getAllByRole('checkbox', { name: /^select \w+\.iso$/i }).map(c => c.getAttribute('aria-label'));

    await selectRow(/select alpha\.iso/i);
    // Speeds swap on the next poll; a frozen list must not reorder underneath.
    vi.mocked(client.getAllTorrents).mockResolvedValue([
      makeTorrent({ gid: 'a', name: 'alpha.iso', download_speed: 5000 }),
      makeTorrent({ gid: 'b', name: 'beta.iso', download_speed: 10 }),
    ]);

    await waitFor(() => expect(client.getAllTorrents).toHaveBeenCalledTimes(2), { timeout: 4000 });
    const after = screen.getAllByRole('checkbox', { name: /^select \w+\.iso$/i }).map(c => c.getAttribute('aria-label'));
    expect(after).toEqual(before);
  });

  it('lets the order resume once the user is done', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);
    await screen.findByText('alpha.iso');

    await selectRow(/select alpha\.iso/i);
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();

    await userEvent.click(within(bulkBar()).getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(screen.queryByText(/1 selected/)).not.toBeInTheDocument());
  });

  it('keeps a detail panel open across a page-size change', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);
    await screen.findByText('alpha.iso');

    await userEvent.click(screen.getAllByRole('button', { name: /expand details/i })[0]);
    expect(await screen.findByRole('tab', { name: /peers/i })).toBeInTheDocument();

    // Expansion used to live in the row, so anything that unmounted it — paging,
    // sorting, filtering — silently closed the panel.
    await userEvent.click(screen.getByRole('button', { name: /speed/i }));
    expect(screen.getByRole('tab', { name: /peers/i })).toBeInTheDocument();
  });

  it('offers a density toggle and remembers the choice', async () => {
    setup(two);
    renderWithProviders(<TorrentsPage />);
    await screen.findByText('alpha.iso');

    const toggle = screen.getByRole('button', { name: /switch to compact rows/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);

    expect(localStorage.getItem('smuggler.torrents.density')).toBe('compact');
    expect(screen.getByRole('button', { name: /switch to comfortable rows/i }))
      .toHaveAttribute('aria-pressed', 'true');
  });
});
