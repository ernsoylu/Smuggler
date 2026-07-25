import { describe, it, expect } from 'vitest'
import { parseHash, toHash, isPage, PAGES, DEFAULT_PAGE } from './router'

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
