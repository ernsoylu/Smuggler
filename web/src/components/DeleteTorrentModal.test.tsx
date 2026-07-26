import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { DeleteTorrentModal } from './DeleteTorrentModal';

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  isPending: false,
  torrentName: 'ubuntu-24.04.iso',
};

const confirmButton = () => screen.getByRole('button', { name: /^remove$/i });
const filesCheckbox = () => screen.getByRole('checkbox');

describe('DeleteTorrentModal', () => {
  it('renders nothing when closed', () => {
    renderWithProviders(<DeleteTorrentModal {...props} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the torrent in the single case', () => {
    renderWithProviders(<DeleteTorrentModal {...props} />);
    expect(screen.getByRole('heading', { name: /remove torrent/i })).toBeInTheDocument();
    expect(screen.getByText('ubuntu-24.04.iso')).toBeInTheDocument();
  });

  it('switches to a count in the bulk case', () => {
    renderWithProviders(<DeleteTorrentModal {...props} count={12} />);
    expect(screen.getByRole('heading', { name: /remove 12 torrents/i })).toBeInTheDocument();
    expect(screen.getByText('12 torrents selected')).toBeInTheDocument();
    // The single torrent's name must not leak into bulk copy.
    expect(screen.queryByText('ubuntu-24.04.iso')).not.toBeInTheDocument();
  });

  it('treats a count of one as the single case', () => {
    renderWithProviders(<DeleteTorrentModal {...props} count={1} />);
    // Mantine puts title and subtitle in one heading, so match on content
    // rather than an anchored accessible name.
    expect(screen.getByRole('heading')).toHaveTextContent(/remove torrent/i);
    expect(screen.queryByText(/torrents selected/i)).not.toBeInTheDocument();
  });

  it('defaults to keeping downloaded files', async () => {
    const onConfirm = vi.fn();
    renderWithProviders(<DeleteTorrentModal {...props} onConfirm={onConfirm} />);

    expect(filesCheckbox()).not.toBeChecked();
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('passes the delete-files choice through, including for bulk', async () => {
    const onConfirm = vi.fn();
    renderWithProviders(<DeleteTorrentModal {...props} count={5} onConfirm={onConfirm} />);

    await userEvent.click(filesCheckbox());
    await userEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('resets the delete-files choice between openings', async () => {
    const { rerender } = renderWithProviders(<DeleteTorrentModal {...props} />);
    await userEvent.click(filesCheckbox());
    expect(filesCheckbox()).toBeChecked();

    rerender(<DeleteTorrentModal {...props} isOpen={false} />);
    rerender(<DeleteTorrentModal {...props} isOpen />);

    // A checkbox that remembered "yes" across openings would delete files on a
    // later confirm the user never opted into.
    expect(filesCheckbox()).not.toBeChecked();
  });

  it('blocks dismissal while the removal is in flight', async () => {
    const onClose = vi.fn();
    renderWithProviders(<DeleteTorrentModal {...props} isPending onClose={onClose} />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is announced as a modal dialog', () => {
    renderWithProviders(<DeleteTorrentModal {...props} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/remove torrent/i);
  });
});
