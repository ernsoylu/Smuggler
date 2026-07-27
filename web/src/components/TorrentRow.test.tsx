import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table } from '@mantine/core';
import type { ReactElement } from 'react';
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
const { TorrentRow } = await import('./TorrentRow');

/**
 * TorrentRow renders Mantine Table.Tr cells, which read Table context — a bare
 * <table><tbody> throws "Table component was not found in the tree".
 */
const inTable = (ui: ReactElement) =>
  renderWithProviders(<Table><Table.Tbody>{ui}</Table.Tbody></Table>);

const renderRow = (overrides: Partial<Torrent> = {}) =>
  inTable(<TorrentRow torrent={makeTorrent(overrides)} />);

beforeEach(() => vi.clearAllMocks());

describe('TorrentRow actions', () => {
  it('keeps the row actions visible without hovering', () => {
    renderRow({ status: 'active' });

    // The pre-Mantine markup hid these behind `opacity-0 group-hover:*`, which
    // made them undiscoverable on touch and invisible to a keyboard user
    // tabbing onto them. They must stay unconditionally rendered and visible.
    for (const name of ['Resume', 'Pause', 'Remove']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
  });

  it('offers pause but not resume while active', () => {
    renderRow({ status: 'active' });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('offers resume but not pause while paused', () => {
    renderRow({ status: 'paused' });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  });

  it('names the row actions the same way the bulk bar does', () => {
    // One operation, one verb: tooltips said Start/Stop while the bulk bar and
    // the status vocabulary said Resume/Pause.
    renderRow({ status: 'active' });
    for (const name of ['Resume', 'Pause', 'Remove']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('pauses the torrent on its own mule and gid', async () => {
    renderRow({ mule: 'mule-7', gid: 'gid-xyz', status: 'active' });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(client.pauseTorrent).toHaveBeenCalledWith('mule-7', 'gid-xyz'));
  });

  it('confirms before removing instead of removing outright', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(client.removeTorrent).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText(/remove torrent/i)).toBeInTheDocument();
  });
});

describe('TorrentRow detail panel', () => {
  it('stays collapsed until asked', () => {
    renderRow();
    expect(screen.queryByRole('tab', { name: /peers/i })).not.toBeInTheDocument();
  });

  it('reveals the detail tabs when expanded', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /expand details/i }));
    expect(screen.getByRole('tab', { name: /peers/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /files/i })).toBeInTheDocument();
  });

  it('fetches peers only once the peers tab is open', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /expand details/i }));
    expect(client.getTorrentPeers).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: /peers/i }));
    await waitFor(() => expect(client.getTorrentPeers).toHaveBeenCalled());
  });

  it('never calls out to a third party to render peers', async () => {
    // Peer country flags used to be resolved by fetching get.geojs.io per peer,
    // from the browser, handing the peer list to a third party. Nothing in this
    // component may reach the network except through the api client.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.mocked(client.getTorrentPeers).mockResolvedValue([
      { ip: '203.0.113.9', port: '51413', download_speed: 10, upload_speed: 0,
        seeder: false, progress: 0.4, am_choking: false, peer_choking: false },
    ]);

    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /expand details/i }));
    await userEvent.click(screen.getByRole('tab', { name: /peers/i }));
    await screen.findByText(/203\.0\.113\.9/);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('TorrentRow selection', () => {
  it('reports its own key when the checkbox is toggled', async () => {
    const onToggleSelected = vi.fn();
    inTable(
      <TorrentRow torrent={makeTorrent({ name: 'debian.iso' })} onToggleSelected={onToggleSelected} />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /select debian\.iso/i }));
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
  });

  it('reflects the selected state', () => {
    inTable(<TorrentRow torrent={makeTorrent()} selected />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});

describe('TorrentRow display', () => {
  it('shows an error status distinctly', () => {
    renderRow({ status: 'error', error_message: 'tracker unreachable' });
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('marks a metadata-only torrent', () => {
    renderRow({ is_metadata: true, status: 'active' });
    expect(screen.getByText(/\(Meta\)/)).toBeInTheDocument();
  });

  it('shows a dash for ETA when the torrent is not active', () => {
    const { container } = renderRow({ status: 'paused', eta: 500 });
    const cells = within(container).getAllByRole('cell');
    expect(cells.some(c => c.textContent?.trim() === '—')).toBe(true);
  });
});
