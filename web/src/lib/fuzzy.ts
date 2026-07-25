/**
 * Subsequence matcher for the command palette, so "stg" finds "Settings".
 *
 * Deliberately not a ranking algorithm — the palette has a dozen entries, and
 * "does this contain the typed letters in order" is enough.
 */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  const h = haystack.toLowerCase();
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return true;
  }
  return false;
}
