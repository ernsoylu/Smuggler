import { createContext, useContext } from 'react';

/**
 * Shell-level actions any page (or the command palette) can trigger.
 *
 * The Add Torrent and Deploy Mule modals used to be owned by TorrentsPage and
 * MulesPage, which meant the palette had no way to open them without either
 * duplicating the modal or signalling across components. App owns them now and
 * exposes the openers here.
 */
export interface UiActions {
  openAddTorrent: () => void;
  openDeployMule: () => void;
}

export const UiActionsContext = createContext<UiActions | null>(null);

export function useUiActions(): UiActions {
  const ctx = useContext(UiActionsContext);
  if (!ctx) throw new Error('useUiActions must be used within App');
  return ctx;
}
