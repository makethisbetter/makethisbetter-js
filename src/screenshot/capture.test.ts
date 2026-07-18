import { afterEach, describe, expect, it, vi } from 'vitest'
import { toJpeg } from 'html-to-image'
import { captureScreenshot } from './capture'
import type { Annotation } from '../types'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
}))

const toJpegMock = vi.mocked(toJpeg)

describe('captureScreenshot', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    toJpegMock.mockClear()
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
        cacheBust: true,
        skipAutoScale: false,
      }),
    )
  })

  it('mounts pin annotations during capture and removes them after capture', async () => {
    let captureText = ''
    toJpegMock.mockImplementationOnce(async () => {
      captureText = document.querySelector<HTMLElement>('[data-mtb-capture-annotations]')?.textContent ?? ''
      return 'data:image/jpeg;base64,/9j/AA=='
    })

    const annotation: Annotation = { type: 'pin', x: 40, y: 60 }
    await captureScreenshot([annotation])

    expect(captureText).toContain('1')
    expect(document.querySelector('[data-mtb-capture-annotations]')).toBeNull()
  })

  it('mounts draw annotations during capture', async () => {
    let drawPath: string | null = null
    toJpegMock.mockImplementationOnce(async () => {
      drawPath = document.querySelector('[data-mtb-capture-annotations] path')?.getAttribute('d') ?? null
      return 'data:image/jpeg;base64,/9j/AA=='
    })

    const annotation: Annotation = { type: 'draw', x: 50, y: 50, drawPath: 'M 10 10 L 90 90' }
    await captureScreenshot([annotation])

    expect(drawPath).toBe('M 10 10 L 90 90')
  })

  it('returns null and cleans up if capture fails', async () => {
    toJpegMock.mockRejectedValueOnce(new Error('capture failed'))

    const annotation: Annotation = { type: 'pin', x: 40, y: 60 }
    const blob = await captureScreenshot([annotation])

    expect(blob).toBeNull()
    expect(document.querySelector('[data-mtb-capture-annotations]')).toBeNull()
  })
})
