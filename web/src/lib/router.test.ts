import { describe, it, expect } from 'vitest'
import { parseHash, toHash, isPage, PAGES, PAGE_LABELS, DEFAULT_PAGE } from './router'

describe('parseHash', () => {
  it('reads each known page', () => {
    for (const p of PAGES) {
      expect(parseHash(`#/${p}`)).toBe(p)
    }
  })

  it('tolerates a missing leading slash', () => {
    expect(parseHash('#mules')).toBe('mules')
  })

  it('falls back to the default for empty, unknown or malformed hashes', () => {
    expect(parseHash('')).toBe(DEFAULT_PAGE)
    expect(parseHash('#')).toBe(DEFAULT_PAGE)
    expect(parseHash('#/nope')).toBe(DEFAULT_PAGE)
    expect(parseHash('#/../etc/passwd')).toBe(DEFAULT_PAGE)
  })

  it('is case-insensitive and ignores a query suffix', () => {
    expect(parseHash('#/MULES')).toBe('mules')
    expect(parseHash('#/configs?x=1')).toBe('configs')
  })

  it('round-trips through toHash', () => {
    for (const p of PAGES) {
      expect(parseHash(toHash(p))).toBe(p)
    }
  })
})

describe('isPage', () => {
  it('accepts known pages and rejects anything else', () => {
    expect(isPage('settings')).toBe(true)
    expect(isPage('workers')).toBe(false)   // the pre-rename name must not resolve
    expect(isPage('')).toBe(false)
  })
})

describe('PAGE_LABELS', () => {
  it('names every route, so no nav surface can render a blank tab', () => {
    // Three surfaces read this now — the top strip, the phone tab bar and the
    // command palette — and a page added without a label would show as an
    // unlabelled icon in all three.
    for (const p of PAGES) {
      expect(PAGE_LABELS[p]).toBeTruthy()
    }
    expect(Object.keys(PAGE_LABELS)).toHaveLength(PAGES.length)
  })

  it('never says "worker"', () => {
    // CLAUDE.md: always "mule".
    for (const label of Object.values(PAGE_LABELS)) {
      expect(label.toLowerCase()).not.toContain('worker')
    }
  })
})
