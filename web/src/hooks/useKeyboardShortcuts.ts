import { useEffect } from 'react';

export interface Shortcut {
  /** Lower-case key, e.g. 'k' or '/'. */
  key: string;
  /** Require Ctrl (or Cmd on macOS). */
  mod?: boolean;
  run: (e: KeyboardEvent) => void;
}

/** True when the event came from somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Global keyboard shortcuts.
 *
 * Unmodified keys are ignored while the user is typing, so pressing "n" inside
 * a magnet field cannot open a modal. Modified ones (Ctrl-K) still fire, which
 * is what makes the palette reachable from anywhere.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      for (const s of shortcuts) {
        if (e.key.toLowerCase() !== s.key) continue;
        if (!!s.mod !== mod) continue;
        if (!s.mod && isTypingTarget(e.target)) continue;
        e.preventDefault();
        s.run(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, enabled]);
}
