import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';

/*
 * The five views are stubbed: what is under test is PageView's own routing and
 * error containment, not the pages, which have their own suites and would drag
 * the whole API client in here.
 */
let torrentsThrows = false;

vi.mock('./TorrentsPage', () => ({
  TorrentsPage: () => {
    if (torrentsThrows) throw new Error('torrents exploded');
    return <div>torrents view</div>;
  },
}));
vi.mock('./MulesPage', () => ({ MulesPage: () => <div>mules view</div> }));
vi.mock('./ConfigsPage', () => ({ ConfigsPage: () => <div>configs view</div> }));
vi.mock('./SettingsPage', () => ({ SettingsPage: () => <div>settings view</div> }));
vi.mock('./EventsPage', () => ({ EventsPage: () => <div>events view</div> }));

const { PageView } = await import('./PageView');

beforeEach(() => {
  torrentsThrows = false;
});

describe('PageView', () => {
  it('renders the view named by the route', () => {
    renderWithProviders(<PageView page="mules" />);

    expect(screen.getByText('mules view')).toBeInTheDocument();
  });

  it('shows one view at a time', () => {
    renderWithProviders(<PageView page="configs" />);

    expect(screen.getByText('configs view')).toBeInTheDocument();
    for (const other of ['torrents view', 'mules view', 'events view', 'settings view']) {
      expect(screen.queryByText(other)).not.toBeInTheDocument();
    }
  });

  it('swaps the view when the route changes', () => {
    const { rerender } = renderWithProviders(<PageView page="torrents" />);
    expect(screen.getByText('torrents view')).toBeInTheDocument();

    rerender(<PageView page="events" />);

    expect(screen.getByText('events view')).toBeInTheDocument();
    expect(screen.queryByText('torrents view')).not.toBeInTheDocument();
  });

  describe('when a view throws', () => {
    // React logs the caught error; the boundary handling it is the point.
    let consoleError: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => consoleError.mockRestore());

    it('is caught rather than blanking the app', () => {
      torrentsThrows = true;
      renderWithProviders(<PageView page="torrents" />);

      expect(screen.getByText(/something broke rendering this view/i)).toBeInTheDocument();
    });

    it('clears the error when the user navigates to another view', () => {
      torrentsThrows = true;
      const { rerender } = renderWithProviders(<PageView page="torrents" />);
      expect(screen.getByText(/something broke rendering this view/i)).toBeInTheDocument();

      // Without the key on the boundary its error state would survive this and
      // follow the user onto every later page.
      rerender(<PageView page="mules" />);

      expect(screen.getByText('mules view')).toBeInTheDocument();
      expect(screen.queryByText(/something broke rendering this view/i)).not.toBeInTheDocument();
    });

    it('recovers the same view via Try again once it stops throwing', async () => {
      torrentsThrows = true;
      const { rerender } = renderWithProviders(<PageView page="torrents" />);

      torrentsThrows = false;
      await userEvent.click(screen.getByRole('button', { name: /try again/i }));
      rerender(<PageView page="torrents" />);

      expect(screen.getByText('torrents view')).toBeInTheDocument();
    });
  });
});
