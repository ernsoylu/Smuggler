import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PAGE, parseHash, toHash, type Page } from '../lib/router';

/**
 * Current page from the URL hash, kept in sync with back/forward navigation.
 *
 * Navigating assigns location.hash so each change lands in browser history,
 * which is what makes the back button work.
 */
export function useHashRoute(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setPage(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    // Normalise a bare or bogus hash on first load so the URL is shareable.
    if (parseHash(window.location.hash) === DEFAULT_PAGE && !window.location.hash) {
      window.history.replaceState(null, '', toHash(DEFAULT_PAGE));
    }
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((p: Page) => {
    if (parseHash(window.location.hash) !== p) window.location.hash = toHash(p);
    else setPage(p);
  }, []);

  return [page, navigate];
}
