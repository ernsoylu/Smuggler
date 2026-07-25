import { describe, it, expect } from 'vitest'
import type { Torrent, Mule } from '../api/types'
import {
  filterTorrents, matchesSearch, sortTorrents, nextSort, paginate, totalPages,
  statusCounts, torrentKey, leastLoadedMule, DEFAULT_PAGE_SIZE,
} from './torrentList'

const t = (over: Partial<Torrent> = {}): Torrent => ({
  gid: 'g1', mule: 'mule-a', name: 'Ubuntu 24.04', status: 'active',
  completed_length: 50, total_length: 100, uploaded_length: 0,
  download_speed: 1000, upload_speed: 0, progress: 50, num_seeders: 3,
  connections: 7, info_hash: 'h', is_seed: false, save_path: '/downloads',
  piece_length: 1, num_pieces: 1, eta: 60, ratio: 0.5, tracker: '',
  comment: '', creation_date: 0, mode: '', error_code: '', error_message: '',
  files: [], is_metadata: false,
  ...over,
}) as Torrent

const m = (name: string, status = 'running'): Mule =>
  ({ name, status, id: name, rpc_port: 6800, vpn_config: 'c', vpn_type: 'wireguard', ip_info: null }) as unknown as Mule

describe('matchesSearch', () => {
  it('matches on name, case-insensitively', () => {
    expect(matchesSearch(t({ name: 'Debian ISO' }), 'debian')).toBe(true)
    expect(matchesSearch(t({ name: 'Debian ISO' }), 'DEBIAN')).toBe(true)
  })

  it('matches on mule name too', () => {
    expect(matchesSearch(t({ mule: 'mule-nyc' }), 'nyc')).toBe(true)
  })

  it('an empty or whitespace query matches everything', () => {
    expect(matchesSearch(t(), '')).toBe(true)
    expect(matchesSearch(t(), '   ')).toBe(true)
  })

  it('does not match unrelated text', () => {
    expect(matchesSearch(t({ name: 'Debian' }), 'fedora')).toBe(false)
  })
})

describe('filterTorrents', () => {
  const list = [
    t({ gid: '1', name: 'alpha', status: 'active' }),
    t({ gid: '2', name: 'beta', status: 'paused' }),
    t({ gid: '3', name: 'gamma', status: 'complete' }),
  ]

  it('all + empty query returns everything', () => {
    expect(filterTorrents(list, 'all', '')).toHaveLength(3)
  })

  it('filters by status', () => {
    expect(filterTorrents(list, 'paused', '').map(x => x.gid)).toEqual(['2'])
  })

  it('combines status and search', () => {
    expect(filterTorrents(list, 'active', 'alpha')).toHaveLength(1)
    expect(filterTorrents(list, 'active', 'beta')).toHaveLength(0)
  })
})

describe('sortTorrents', () => {
  it('returns input unchanged when no sort is set', () => {
    const list = [t({ gid: 'b' }), t({ gid: 'a' })]
    expect(sortTorrents(list, null).map(x => x.gid)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const list = [t({ name: 'z' }), t({ name: 'a' })]
    const copy = [...list]
    sortTorrents(list, { key: 'name', direction: 'asc' })
    expect(list).toEqual(copy)
  })

  it('sorts strings alphabetically both ways', () => {
    const list = [t({ name: 'zeta' }), t({ name: 'alpha' })]
    expect(sortTorrents(list, { key: 'name', direction: 'asc' })[0].name).toBe('alpha')
    expect(sortTorrents(list, { key: 'name', direction: 'desc' })[0].name).toBe('zeta')
  })

  it('sorts numerics numerically, not lexically', () => {
    const list = [t({ download_speed: 9 }), t({ download_speed: 100 })]
    expect(sortTorrents(list, { key: 'speed', direction: 'asc' })[0].download_speed).toBe(9)
  })

  it('sorts unknown ETA (-1) last when ascending', () => {
    const list = [t({ gid: 'unknown', eta: -1 }), t({ gid: 'soon', eta: 30 })]
    const asc = sortTorrents(list, { key: 'eta', direction: 'asc' })
    expect(asc.map(x => x.gid)).toEqual(['soon', 'unknown'])
  })
})

describe('nextSort', () => {
  it('cycles asc -> desc -> cleared', () => {
    const a = nextSort(null, 'name')
    expect(a).toEqual({ key: 'name', direction: 'asc' })
    const b = nextSort(a, 'name')
    expect(b).toEqual({ key: 'name', direction: 'desc' })
    expect(nextSort(b, 'name')).toBeNull()
  })

  it('switching column starts at asc', () => {
    expect(nextSort({ key: 'name', direction: 'desc' }, 'ratio'))
      .toEqual({ key: 'ratio', direction: 'asc' })
  })
})

describe('paginate', () => {
  const list = Array.from({ length: 30 }, (_, i) => i)

  it('slices the requested page', () => {
    expect(paginate(list, 2, 10)).toEqual(list.slice(10, 20))
  })

  it('clamps a page beyond the end instead of returning nothing', () => {
    // The list shrinks under a user sitting on page 3; they should see content.
    expect(paginate(list, 99, 10)).toEqual(list.slice(20, 30))
  })

  it('clamps a page below 1', () => {
    expect(paginate(list, 0, 10)).toEqual(list.slice(0, 10))
  })

  it('totalPages is at least 1 even when empty', () => {
    expect(totalPages(0, DEFAULT_PAGE_SIZE)).toBe(1)
    expect(totalPages(30, 25)).toBe(2)
  })
})

describe('statusCounts', () => {
  it('counts each status and the total', () => {
    const c = statusCounts([
      t({ status: 'active' }), t({ status: 'active' }), t({ status: 'error' }),
    ])
    expect(c).toMatchObject({ all: 3, active: 2, error: 1, paused: 0, complete: 0 })
  })
})

describe('torrentKey', () => {
  it('scopes gid by mule, since gid is only unique per mule', () => {
    expect(torrentKey({ mule: 'a', gid: '1' })).not.toBe(torrentKey({ mule: 'b', gid: '1' }))
  })
})

describe('leastLoadedMule', () => {
  it('returns null when nothing is running', () => {
    expect(leastLoadedMule([], [])).toBeNull()
    expect(leastLoadedMule([m('a', 'exited')], [])).toBeNull()
  })

  it('ignores mules that are not running', () => {
    const picked = leastLoadedMule([m('busy'), m('stopped', 'exited')], [t({ mule: 'busy' })])
    expect(picked?.name).toBe('busy')
  })

  it('picks the mule with the fewest torrents', () => {
    const mules = [m('a'), m('b')]
    const torrents = [t({ gid: '1', mule: 'a' }), t({ gid: '2', mule: 'a' }), t({ gid: '3', mule: 'b' })]
    expect(leastLoadedMule(mules, torrents)?.name).toBe('b')
  })

  it('breaks ties deterministically by name', () => {
    const mules = [m('zeta'), m('alpha')]
    expect(leastLoadedMule(mules, [])?.name).toBe('alpha')
    expect(leastLoadedMule([...mules].reverse(), [])?.name).toBe('alpha')
  })

  it('ignores torrents belonging to unknown mules', () => {
    expect(leastLoadedMule([m('a')], [t({ mule: 'ghost' })])?.name).toBe('a')
  })
})
