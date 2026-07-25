import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches an exact substring', () => {
    expect(fuzzyMatch('Go to Settings', 'settings')).toBe(true)
  })

  it('matches a subsequence with gaps', () => {
    expect(fuzzyMatch('Go to Settings', 'stg')).toBe(true)
    expect(fuzzyMatch('Deploy mule', 'dpm')).toBe(true)
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(fuzzyMatch('Add torrent', '  ADD ')).toBe(true)
  })

  it('an empty needle matches everything', () => {
    expect(fuzzyMatch('anything', '')).toBe(true)
    expect(fuzzyMatch('anything', '   ')).toBe(true)
  })

  it('requires the letters in order', () => {
    expect(fuzzyMatch('Add torrent', 'tdd')).toBe(false)
  })

  it('rejects letters that are not present', () => {
    expect(fuzzyMatch('Add torrent', 'zzz')).toBe(false)
  })
})
