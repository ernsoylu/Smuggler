import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { makeTorrent } from '../test/fixtures';
import type { Torrent } from '../api/types';

vi.mock('../api/client', () => ({
  pauseTorrent: vi.fn().mockResolvedValue(undefined),
  resumeTorrent: vi.fn().mockResolvedValue(undefined),
  removeTorrent: vi.fn().mockResolvedValue(undefined),
  getTorrentPeers: vi.fn().mockResolvedValue([]),
  getTorrentOptions: vi.fn().mockResolvedValue({
    max_download_speed: 0, max_upload_speed: 0, max_connections: 1, prioritize_first_last: false,
  }),
  setTorrentOptions: vi.fn().mockResolvedValue(undefined),
  setFileSelection: vi.fn().mockResolvedValue(undefined),
  setTorrentCategory: vi.fn().mockResolvedValue(undefined),
}));

const client = await import('../api/client');
const { TorrentCard } = await import('./TorrentCard');

const renderCard = (overrides: Partial<Torrent> = {}) =>
  renderWithProviders(<TorrentCard torrent={makeTorrent(overrides)} />);

/** Opens the card's action menu and returns its dropdown. */
const openMenu = async (name = /actions for/i) => {
  await userEvent.click(screen.getByRole('button', { name }));
  return within(await screen.findByRole('menu'));
};

beforeEach(() => vi.clearAllMocks());

describe('TorrentCard actions', () => {
  it('offers the same three operations the table row does', async () => {
    renderCard();
    const menu = await openMenu();

    for (const name of ['Resume', 'Pause', 'Remove']) {
      expect(menu.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('offers pause but not resume while active', async () => {
    renderCard({ status: 'active' });
    const menu = await openMenu();

    expect(menu.getByRole('menuitem', { name: 'Resume' })).toHaveAttribute('data-disabled');
    expect(menu.getByRole('menuitem', { name: 'Pause' })).not.toHaveAttribute('data-disabled');
  });

  it('offers resume but not pause while paused', async () => {
    renderCard({ status: 'paused' });
    const menu = await openMenu();

    expect(menu.getByRole('menuitem', { name: 'Pause' })).toHaveAttribute('data-disabled');
    expect(menu.getByRole('menuitem', { name: 'Resume' })).not.toHaveAttribute('data-disabled');
  });

  it('pauses the torrent on its own mule and gid', async () => {
    renderCard({ mule: 'mule-7', gid: 'gid-xyz', status: 'active' });
    const menu = await openMenu();

    await userEvent.click(menu.getByRole('menuitem', { name: 'Pause' }));

    await waitFor(() => expect(client.pauseTorrent).toHaveBeenCalledWith('mule-7', 'gid-xyz'));
  });

  it('confirms before removing instead of removing outright', async () => {
    // The card reaches the same destructive path through a menu rather than a
    // row button; the confirmation must not be lost on the way.
    renderCard();
    const menu = await openMenu();
    await userEvent.click(menu.getByRole('menuitem', { name: 'Remove' }));

    expect(client.removeTorrent).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('TorrentCard display', () => {
  it('shows the columns the table pushed off a phone screen', async () => {
    // Speed, ETA and ratio all sat past the 960px minimum, reachable only by
    // swiping the table sideways. On the card they are on screen.
    renderCard({ status: 'active', download_speed: 11_744_051, eta: 252, ratio: 2.14 });

    expect(await screen.findByText('11.2 MB/s')).toBeInTheDocument();
    expect(screen.getByText('4m 12s')).toBeInTheDocument();
    expect(screen.getByText(/2\.14/)).toBeInTheDocument();
  });

  it('states progress as a number, not only as a bar', () => {
    renderCard({ progress: 62.4, completed_length: 512, total_length: 1024 });

    expect(screen.getByText('62.4%')).toBeInTheDocument();
    expect(screen.getByText('512 B / 1 KB')).toBeInTheDocument();
  });

  it('names the routing mule, which the phone layout would otherwise lose', () => {
    renderCard({ mule: 'frankfurt-1' });

    expect(screen.getByText('frankfurt-1')).toBeInTheDocument();
  });

  it('marks a metadata-only torrent', () => {
    renderCard({ is_metadata: true, status: 'active' });

    expect(screen.getByText(/\(Meta\)/)).toBeInTheDocument();
  });

  it('hides the ETA on a stopped torrent rather than showing a stale countdown', () => {
    renderCard({ status: 'paused', eta: 500 });

    expect(screen.queryByText('8m 20s')).not.toBeInTheDocument();
  });
});

describe('TorrentCard selection', () => {
  it('reports its own key when the checkbox is toggled', async () => {
    const onToggleSelected = vi.fn();
    renderWithProviders(
      <TorrentCard torrent={makeTorrent({ name: 'debian.iso' })} onToggleSelected={onToggleSelected} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /select debian\.iso/i }));
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
  });

  it('answers to the same accessible name the row does, so bulk selection is identical', () => {
    renderCard({ name: 'alpha.iso' });

    expect(screen.getByRole('checkbox', { name: 'Select alpha.iso' })).toBeInTheDocument();
  });
});

describe('TorrentCard detail panel', () => {
  it('stays collapsed until asked', () => {
    renderCard();

    expect(screen.queryByRole('tab', { name: /peers/i })).not.toBeInTheDocument();
  });

  it('reaches files, peers and options — not a cut-down mobile view', async () => {
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: /expand details/i }));

    for (const tab of [/status/i, /details/i, /files/i, /peers/i, /options/i]) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
  });

  it('fetches peers only once the peers tab is open', async () => {
    // A collapsed list of cards must not poll peers for every torrent in it.
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: /expand details/i }));
    expect(client.getTorrentPeers).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: /peers/i }));

    await waitFor(() => expect(client.getTorrentPeers).toHaveBeenCalled());
  });
});
