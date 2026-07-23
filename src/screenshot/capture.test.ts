import { afterEach, describe, expect, it, vi } from 'vitest'
import { toJpeg } from 'html-to-image'
import { captureScreenshot, parsePathPolylines } from './capture'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
}))

const toJpegMock = vi.mocked(toJpeg)

class ImmediatelyFailingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.())
  }
}

describe('captureScreenshot', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    toJpegMock.mockClear()
    vi.unstubAllGlobals()
  })

  it('captures a compressed jpeg blob', async () => {
    const blob = await captureScreenshot()

    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('image/jpeg')
    expect(toJpegMock).toHaveBeenCalledWith(
      document.body,
      expect.objectContaining({
        quality: 0.85,
        pixelRatio: 1,
        skipFonts: true,
        skipAutoScale: false,
      }),
    )
  })

  it('does not mount anything into the live page while capturing', async () => {
    let bodyChildrenDuringCapture = -1
    document.body.innerHTML = '<main>content</main>'
    toJpegMock.mockImplementationOnce(async () => {
      bodyChildrenDuringCapture = document.body.childElementCount
      return 'data:image/jpeg;base64,/9j/AA=='
    })
    vi.stubGlobal('Image', ImmediatelyFailingImage)

    await captureScreenshot([{ type: 'draw', x: 1, y: 2, drawPath: 'M 0 0 L 5 5' }])

    expect(bodyChildrenDuringCapture).toBe(1)
    expect(document.body.childElementCount).toBe(1)
  })

  it('falls back to the plain screenshot when the bitmap cannot be loaded for baking', async () => {
    vi.stubGlobal('Image', ImmediatelyFailingImage)

    const blob = await captureScreenshot([{ type: 'pin', x: 10, y: 20 }])

    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('image/jpeg')
  })

  it('returns null when the capture itself fails', async () => {
    toJpegMock.mockRejectedValueOnce(new Error('capture failed'))

    const blob = await captureScreenshot()

    expect(blob).toBeNull()
  })
})

describe('parsePathPolylines', () => {
  it('parses a single M/L polyline', () => {
    expect(parsePathPolylines('M 10 20 L 30 40 L 50 60')).toEqual([
      [[10, 20], [30, 40], [50, 60]],
    ])
  })

  it('splits multiple strokes on M commands', () => {
    expect(parsePathPolylines('M 1 2 L 3 4 M 5 6 L 7 8')).toEqual([
      [[1, 2], [3, 4]],
      [[5, 6], [7, 8]],
    ])
  })

  it('handles decimals and negatives and ignores junk', () => {
    expect(parsePathPolylines('M 1.5 -2.25 L -3 4.75 Z garbage')).toEqual([
      [[1.5, -2.25], [-3, 4.75]],
    ])
  })

  it('returns no polylines for an empty path', () => {
    expect(parsePathPolylines('')).toEqual([])
  })
})
