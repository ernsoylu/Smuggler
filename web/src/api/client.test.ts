import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock the axios instance returned by axios.create() so we can assert on the
// URL / verb / params each client helper issues, without a real network call.
// vi.mock is hoisted above imports, so the instance must be created via
// vi.hoisted to exist at mock-factory evaluation time.
const mockInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
}))
vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockInstance) },
}))

import * as client from './client'

const asFile = () => new Blob(['data']) as unknown as File

beforeEach(() => {
  vi.clearAllMocks()
  mockInstance.get.mockResolvedValue({ data: [] })
  mockInstance.post.mockResolvedValue({ data: { gid: 'g1' } })
  mockInstance.delete.mockResolvedValue({ data: undefined })
  mockInstance.patch.mockResolvedValue({ data: undefined })
})

describe('mule endpoints', () => {
  it('getMules hits /mules/', async () => {
    await client.getMules()
    expect(mockInstance.get).toHaveBeenCalledWith('/mules/')
  })

  it('getMule encodes the name into the path', async () => {
    mockInstance.get.mockResolvedValue({ data: { name: 'm1' } })
    await client.getMule('m1')
    expect(mockInstance.get).toHaveBeenCalledWith('/mules/m1')
  })

  it('createMule posts multipart form data', async () => {
    mockInstance.post.mockResolvedValue({ data: { name: 'm1' } })
    await client.createMule(asFile(), 'm1')
    const [url, body] = mockInstance.post.mock.calls[0]
    expect(url).toBe('/mules/')
    expect(body).toBeInstanceOf(FormData)
  })

  it('stopMule issues a DELETE', async () => {
    await client.stopMule('m1')
    expect(mockInstance.delete).toHaveBeenCalledWith('/mules/m1')
  })

  it('killMule posts to the kill route', async () => {
    await client.killMule('m1')
    expect(mockInstance.post).toHaveBeenCalledWith('/mules/m1/kill')
  })
})

describe('torrent endpoints', () => {
  it('getAllTorrents hits /torrents/', async () => {
    await client.getAllTorrents()
    expect(mockInstance.get).toHaveBeenCalledWith('/torrents/')
  })

  it('addMagnet posts the magnet body', async () => {
    await client.addMagnet('m1', 'magnet:?x')
    expect(mockInstance.post).toHaveBeenCalledWith('/torrents/m1', { magnet: 'magnet:?x' })
  })

  it('removeTorrent passes the delete_files param', async () => {
    await client.removeTorrent('m1', 'g1', true)
    expect(mockInstance.delete).toHaveBeenCalledWith('/torrents/m1/g1', {
      params: { delete_files: true },
    })
  })

  it('pauseTorrent / resumeTorrent post to their routes', async () => {
    await client.pauseTorrent('m1', 'g1')
    await client.resumeTorrent('m1', 'g1')
    expect(mockInstance.post).toHaveBeenCalledWith('/torrents/m1/g1/pause')
    expect(mockInstance.post).toHaveBeenCalledWith('/torrents/m1/g1/resume')
  })

  it('setFileSelection patches selected_indices', async () => {
    await client.setFileSelection('m1', 'g1', [0, 2])
    expect(mockInstance.patch).toHaveBeenCalledWith('/torrents/m1/g1/files', {
      selected_indices: [0, 2],
    })
  })
})

describe('settings & configs', () => {
  it('saveSettings posts a partial settings object', async () => {
    mockInstance.post.mockResolvedValue({ data: { ok: true, settings: {} } })
    await client.saveSettings({ download_dir: '/d' })
    expect(mockInstance.post).toHaveBeenCalledWith('/settings/', { download_dir: '/d' })
  })

  it('uploadConfig appends optional credentials to the form', async () => {
    mockInstance.post.mockResolvedValue({ data: { id: 1 } })
    await client.uploadConfig(asFile(), 'n', 'u', 'p')
    const [url, body] = mockInstance.post.mock.calls[0]
    expect(url).toBe('/configs/')
    expect(body).toBeInstanceOf(FormData)
  })

  it('deleteConfig issues a DELETE by id', async () => {
    await client.deleteConfig(7)
    expect(mockInstance.delete).toHaveBeenCalledWith('/configs/7')
  })

  it('deployMuleFromConfig posts a name', async () => {
    mockInstance.post.mockResolvedValue({ data: { name: 'm1' } })
    await client.deployMuleFromConfig(3, 'm1')
    expect(mockInstance.post).toHaveBeenCalledWith('/configs/3/deploy', { name: 'm1' })
  })
})

describe('watchdog', () => {
  it('evacuateMule passes the kill param', async () => {
    mockInstance.post.mockResolvedValue({ data: {} })
    await client.evacuateMule('m1', false)
    expect(mockInstance.post).toHaveBeenCalledWith('/mules/m1/evacuate', null, {
      params: { kill: false },
    })
  })

  it('triggerWatchdogSweep posts to /watchdog/run', async () => {
    mockInstance.post.mockResolvedValue({ data: { swept: 0, results: [] } })
    await client.triggerWatchdogSweep()
    expect(mockInstance.post).toHaveBeenCalledWith('/watchdog/run')
  })
})
