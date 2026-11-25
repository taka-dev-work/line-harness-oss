import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpClient } from '../src/http.js'
import { LineHarnessError } from '../src/errors.js'

describe('HttpClient', () => {
  let http: HttpClient

  beforeEach(() => {
    http = new HttpClient({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      timeout: 5000,
    })
  })

  it('sends GET with auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: '1' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await http.get('/api/friends')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/friends',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    )
    expect(result).toEqual({ success: true, data: { id: '1' } })
    vi.unstubAllGlobals()
  })

  it('sends POST with JSON body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: '1' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await http.post('/api/tags', { name: 'VIP' })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'VIP' }),
      }),
    )
    vi.unstubAllGlobals()
  })

  it('throws LineHarnessError on 4xx/5xx', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ success: false, error: 'Not found' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(http.get('/api/scenarios/xxx')).rejects.toThrow(LineHarnessError)
    await expect(http.get('/api/scenarios/xxx')).rejects.toMatchObject({
      status: 404,
      message: 'Not found',
      endpoint: 'GET /api/scenarios/xxx',
    })
    vi.unstubAllGlobals()
  })
})

describe('HttpClient Cloudflare Access service token', () => {
  const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) })

  it('adds access headers when configured', async () => {
    const mockFetch = okFetch()
    vi.stubGlobal('fetch', mockFetch)
    const http = new HttpClient({
      baseUrl: 'https://admin.acme.example', apiKey: 'k', timeout: 5000,
      accessClientId: 'id.access', accessClientSecret: 'secret-value',
    })
    await http.get('/api/tags')
    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['CF-Access-Client-Id']).toBe('id.access')
    expect(headers['CF-Access-Client-Secret']).toBe('secret-value')
    expect(headers.Authorization).toBe('Bearer k')
    vi.unstubAllGlobals()
  })

  it('omits them when not configured', async () => {
    const mockFetch = okFetch()
    vi.stubGlobal('fetch', mockFetch)
    const http = new HttpClient({ baseUrl: 'https://admin.acme.example', apiKey: 'k', timeout: 5000 })
    await http.get('/api/tags')
    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers).not.toHaveProperty('CF-Access-Client-Id')
    expect(headers).not.toHaveProperty('CF-Access-Client-Secret')
    vi.unstubAllGlobals()
  })

  it('omits them when only one half is configured', async () => {
    const mockFetch = okFetch()
    vi.stubGlobal('fetch', mockFetch)
    const http = new HttpClient({ baseUrl: 'https://admin.acme.example', apiKey: 'k', timeout: 5000, accessClientId: 'id.access' })
    await http.get('/api/tags')
    expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('CF-Access-Client-Id')
    vi.unstubAllGlobals()
  })
})
