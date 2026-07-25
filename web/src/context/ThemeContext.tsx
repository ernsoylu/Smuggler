import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Light/dark/system theme, persisted to localStorage.
 *
 * "system" deliberately removes the data-theme attribute rather than resolving
 * to a value, so the CSS media query in index.css takes over and the app keeps
 * following the OS if it changes while open.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'smuggler.theme';

interface ThemeContextValue {
  preference: ThemePreference;
  /** What is actually on screen right now, with "system" resolved. */
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
  /** Cycles light -> dark -> system. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemePreference {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersLight(): boolean {
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [systemLight, setSystemLight] = useState(systemPrefersLight);

  // Apply to <html>. Removing the attribute is what hands control back to the
  // prefers-color-scheme rule.
  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  // Track OS changes so "system" stays live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => setPreferenceState(p), []);
  const cycle = useCallback(() => {
    setPreferenceState(p => (p === 'light' ? 'dark' : p === 'dark' ? 'system' : 'light'));
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemLight ? 'light' : 'dark') : preference;

  const value = useMemo(
    () => ({ preference, resolved, setPreference, cycle }),
    [preference, resolved, setPreference, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
