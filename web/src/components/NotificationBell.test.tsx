import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, type ReactNode } from 'react';
import { renderWithProviders } from '../test/render';
import { NotificationBell } from './NotificationBell';
import { useNotifications } from '../context/NotificationContext';

/**
 * Pushes one warning after mount, so the bell has something unread.
 *
 * In an effect, not during render: pushing in the render body updates the
 * provider's state mid-render, which React rejects and which left the popover
 * re-rendering out from under the queries.
 */
function WithWarning({ children }: Readonly<{ children?: ReactNode }>) {
  const { push } = useNotifications();
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    push({ type: 'warning', title: 'VPN compromised: mule-1', message: 'exit IP matches host' });
  }, [push]);
  return <>{children}</>;
}

const openPanel = async () => {
  await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
  return screen.findByText(/vpn compromised/i);
};

describe('NotificationBell', () => {
  it('shows the notification once opened', async () => {
    renderWithProviders(<WithWarning><NotificationBell /></WithWarning>);
    expect(await openPanel()).toBeInTheDocument();
  });

  it('does not silently mark everything read just because the panel was opened', async () => {
    renderWithProviders(<WithWarning><NotificationBell /></WithWarning>);
    await openPanel();

    // Glancing at a VPN warning used to clear its unread state — the one class
    // of notification you open the panel to check is the one you would lose.
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeInTheDocument();
  });

  it('marks read only when asked', async () => {
    renderWithProviders(<WithWarning><NotificationBell /></WithWarning>);
    await openPanel();

    await userEvent.click(screen.getByRole('button', { name: /mark all read/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument(),
    );
    // Marking read keeps the notification; only its unread state changes.
    expect(screen.getByText(/vpn compromised/i)).toBeInTheDocument();
  });

  it('keeps clearing separate from marking read', async () => {
    renderWithProviders(<WithWarning><NotificationBell /></WithWarning>);
    await openPanel();

    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));

    await waitFor(() => expect(screen.getByText(/no notifications/i)).toBeInTheDocument());
  });
});
