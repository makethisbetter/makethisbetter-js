import { afterEach, describe, expect, it, vi } from 'vitest'
import { resourceToDataURL } from 'html-to-image/lib/dataurl'

describe('html-to-image resource fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps directly readable resources on their original URL', async () => {
    const resolver = vi.fn(() => 'https://image-proxy.example.com/signed')
    vi.stubGlobal('fetch', vi.fn(async () => imageResponse()))

    const dataUrl = await resourceToDataURL(
      'https://cdn.example.com/readable.png?direct=1',
      'image/png',
      { includeQueryParams: true, resourceUrlResolver: resolver },
    )

    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/readable.png?direct=1', undefined)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('retries an unreadable resource through the resolver', async () => {
    const source = 'https://cdn.example.com/no-cors.png?fallback=1'
    const proxy = 'https://image-proxy.example.com/signed'
    const resolver = vi.fn(() => proxy)
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(imageResponse()))

    const dataUrl = await resourceToDataURL(source, 'image/png', {
      includeQueryParams: true,
      imagePlaceholder: 'data:image/gif;base64,placeholder',
      resourceUrlResolver: resolver,
    })

    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(resolver).toHaveBeenCalledWith(source, 'image/png')
    expect(fetch).toHaveBeenNthCalledWith(1, source, undefined)
    expect(fetch).toHaveBeenNthCalledWith(2, proxy, undefined)
  })

  it('uses the placeholder when both the direct request and proxy fail', async () => {
    const placeholder = 'data:image/gif;base64,placeholder'
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 502 })))

    const dataUrl = await resourceToDataURL(
      'https://cdn.example.com/no-cors.png?proxy-fails=1',
      'image/png',
      {
        includeQueryParams: true,
        imagePlaceholder: placeholder,
        resourceUrlResolver: () => 'https://image-proxy.example.com/failure',
      },
    )

    expect(dataUrl).toBe(placeholder)
  })
})

function imageResponse(): Response {
  return new Response(new Blob(['png'], { type: 'image/png' }), {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  })
}
