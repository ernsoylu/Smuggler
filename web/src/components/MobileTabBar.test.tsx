import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { MobileTabBar } from './MobileTabBar';
import { PAGES, PAGE_LABELS } from '../lib/router';

const bar = () => screen.getByRole('navigation', { name: 'Primary' });

describe('MobileTabBar', () => {
  it('offers every route, so no page is unreachable on a phone', () => {
    renderWithProviders(<MobileTabBar page="torrents" />);

    for (const page of PAGES) {
      expect(within(bar()).getByRole('link', { name: PAGE_LABELS[page] })).toBeInTheDocument();
    }
  });

  it('links to the same hash routes the top strip uses', () => {
    // Anchors, not buttons: the routes are real URLs, so long-press and
    // "open in new tab" have to keep working.
    renderWithProviders(<MobileTabBar page="torrents" />);

    expect(within(bar()).getByRole('link', { name: 'Mules' })).toHaveAttribute('href', '#/mules');
  });

  it('marks the current page for assistive tech, not just visually', () => {
    renderWithProviders(<MobileTabBar page="events" />);

    expect(within(bar()).getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks exactly one tab current', () => {
    renderWithProviders(<MobileTabBar page="configs" />);

    const current = within(bar())
      .getAllByRole('link')
      .filter(a => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Configs');
  });

  it('names each tab in text as well as by icon', () => {
    // Five unlabelled glyphs is what the collapsed top strip already was; the
    // point of moving to the bottom edge was having room for the words.
    renderWithProviders(<MobileTabBar page="torrents" />);

    for (const page of PAGES) {
      expect(within(bar()).getByText(PAGE_LABELS[page])).toBeInTheDocument();
    }
  });
});
