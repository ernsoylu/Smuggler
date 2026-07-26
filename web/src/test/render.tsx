import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationProvider } from '../context/NotificationContext';
import { UiActionsContext, type UiActions } from '../context/UiActionsContext';
import { theme } from '../theme';
import { vi } from 'vitest';

/**
 * Renders a component inside the providers the app actually mounts it under —
 * MantineProvider included, since Mantine components read theme and color
 * scheme from context and misrender without it.
 *
 * Retries are off and gcTime is zero: a component under test that errors should
 * fail the assertion immediately rather than after three silent retries, and no
 * cache should survive into the next case.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Stubbed shell actions, so a test can assert what a component asked for. */
export function makeUiActions(overrides: Partial<UiActions> = {}): UiActions {
  return {
    openAddTorrent: vi.fn(),
    openDeployMule: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}

interface Options {
  uiActions?: UiActions;
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const queryClient = options.queryClient ?? makeQueryClient();
  const uiActions = options.uiActions ?? makeUiActions();

  // env="test" disables Mantine's transitions. Without it, portalled content
  // (Popover, Modal) never finishes entering under jsdom and stays out of the
  // accessibility tree, so getByRole cannot see buttons that are plainly
  // visible in a browser.
  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <MantineProvider theme={theme} forceColorScheme="dark" env="test">
        <QueryClientProvider client={queryClient}>
          <NotificationProvider>
            <UiActionsContext.Provider value={uiActions}>{children}</UiActionsContext.Provider>
          </NotificationProvider>
        </QueryClientProvider>
      </MantineProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper }), queryClient, uiActions };
}
