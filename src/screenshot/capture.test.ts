import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toJpeg } from 'html-to-image'
import { captureScreenshot } from './capture'
import { parsePathPolylines } from './svg-path'
import { getFontEmbedCSS } from 'html-to-image'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
  getFontEmbedCSS: vi.fn(async () => ''),
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
  beforeEach(() => {
    vi.stubGlobal('Image', ImmediatelyLoadingImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => mockCanvasContext() as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    toJpegMock.mockClear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('computes the font embed CSS once and reuses it across captures', async () => {
    const fontMock = vi.mocked(getFontEmbedCSS)
    const callsBefore = fontMock.mock.calls.length

    await captureScreenshot()
    await captureScreenshot()

    // The font set does not change while the page lives; re-walking every
    // stylesheet and re-fetching every font file per capture is what made a
    // single submission fire a hundred-odd font requests.
    expect(fontMock.mock.calls.length - callsBefore).toBeLessThanOrEqual(1)
    const lastOptions = toJpegMock.mock.calls[toJpegMock.mock.calls.length - 1]?.[1]
    expect(lastOptions?.fontEmbedCSS).toBe('')
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
        skipFonts: false,
        skipAutoScale: false,
      }),
    )
  })

  it('keeps the screenshot when a cross-origin image needs a safe placeholder', async () => {
    toJpegMock.mockImplementationOnce(async (_node, options) => {
      if (!options?.imagePlaceholder) throw new Error('cross-origin image failed')

      return 'data:image/jpeg;base64,/9j/AA=='
    })

    const blob = await captureScreenshot()

    expect(blob).toBeInstanceOf(Blob)
    expect(toJpegMock).toHaveBeenCalledWith(
      document.body,
      expect.objectContaining({
        imagePlaceholder: expect.stringMatching(/^data:image\/gif;base64,/),
      }),
    )
  })

  // Rasterizing a page taller than the viewport used to be the widget's single
  // heaviest block of main-thread work — and the bake cropped the result back
  // to roughly a viewport anyway. Height of the document must not leak into
  // the capture size.
  describe('on a page much taller than the viewport', () => {
    function sizeBody(width: number, height: number): void {
      Object.defineProperty(document.body, 'clientWidth', { value: width, configurable: true })
      Object.defineProperty(document.body, 'clientHeight', { value: height, configurable: true })
    }

    it('captures the viewport at full resolution', async () => {
      sizeBody(1600, 20_000)

      await captureScreenshot()

      expect(toJpegMock.mock.calls[0][1]).toMatchObject({
        pixelRatio: 1,
        width: window.innerWidth,
        height: window.innerHeight,
      })
    })

    it('culls only elements below the viewport from the clone', async () => {
      sizeBody(1600, 20_000)
      const below = document.createElement('section')
      vi.spyOn(below, 'getBoundingClientRect').mockReturnValue(rect(0, 5000, 800, 600))
      const above = document.createElement('section')
      vi.spyOn(above, 'getBoundingClientRect').mockReturnValue(rect(0, -4000, 800, 600))
      const visible = document.createElement('section')
      vi.spyOn(visible, 'getBoundingClientRect').mockReturnValue(rect(0, 100, 800, 300))
      const sizeless = document.createElement('style')
      document.body.append(below, above, visible, sizeless)

      await captureScreenshot()

      const { filter } = toJpegMock.mock.calls[0][1] as { filter: (node: Node) => boolean }
      expect(filter(below)).toBe(false)
      expect(filter(visible)).toBe(true)
      // Culling in-flow content ABOVE the viewport would collapse the clone's
      // layout upward and break the capture's scroll alignment.
      expect(filter(above)).toBe(true)
      // Zero-sized nodes carry styles, not pixels — they must survive the cull.
      expect(filter(sizeless)).toBe(true)
    })
  })

  it('shifts the clone so the scrolled-to region lands at the canvas origin', async () => {
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, -2000, 900, 2800))

    await captureScreenshot()

    expect(toJpegMock).toHaveBeenCalledWith(
      document.body,
      expect.objectContaining({
        width: window.innerWidth,
        height: window.innerHeight,
        style: expect.objectContaining({ transform: 'translate(0px, -2000px)' }),
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

  it('bakes brand-colored annotations with a fixed neutral outline and no numbers', async () => {
    const context = mockCanvasContext()
    const strokeStyles = trackStyleAssignments(context, 'strokeStyle')
    const fillStyles = trackStyleAssignments(context, 'fillStyle')
    const shadowColors = trackStyleAssignments(context, 'shadowColor')
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )

    await captureScreenshot(
      [
        { type: 'draw', x: 1, y: 2, drawPath: 'M 0 0 L 5 5' },
        { type: 'pin', x: 10, y: 20 },
      ],
      {
        primary: '#2563eb',
        hover: '#1d4ed8',
        active: '#1e40af',
        onPrimary: '#fefefe',
      },
    )

    expect(strokeStyles).toEqual(expect.arrayContaining([
      'rgba(15, 23, 42, 0.72)',
      '#ffffff',
      '#2563eb',
    ]))
    expect(fillStyles).toContain('#2563eb')
    expect(context.fillText).not.toHaveBeenCalled()
    expect(shadowColors).toContain('rgba(15, 23, 42, 0.68)')
  })

  it('returns null instead of the unfiltered screenshot when the bitmap cannot be loaded', async () => {
    vi.stubGlobal('Image', ImmediatelyFailingImage)

    const blob = await captureScreenshot([{ type: 'pin', x: 10, y: 20 }])

    expect(blob).toBeNull()
  })

  it('returns null when the capture itself fails', async () => {
    toJpegMock.mockRejectedValueOnce(new Error('capture failed'))

    const blob = await captureScreenshot()

    expect(blob).toBeNull()
  })

  it('covers an rr-block region before exporting the screenshot', async () => {
    const context = mockCanvasContext()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1280, 3000))
    const blocked = document.createElement('section')
    blocked.className = 'rr-block'
    vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(25, 40, 320, 180))
    document.body.appendChild(blocked)

    await captureScreenshot()

    expect(context.fillRect).toHaveBeenCalledWith(25, 40, 320, 180)
  })

  it('covers text and form controls inside rr-mask without covering the whole region', async () => {
    const context = mockCanvasContext()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1280, 3000))
    const masked = document.createElement('section')
    masked.className = 'rr-mask'
    vi.spyOn(masked, 'getBoundingClientRect').mockReturnValue(rect(30, 40, 600, 240))
    masked.appendChild(document.createTextNode('Visible account secret'))
    const input = document.createElement('input')
    input.value = 'ordinary form value'
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(rect(40, 90, 200, 32))
    masked.appendChild(input)
    document.body.appendChild(masked)
    vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: vi.fn(),
      getClientRects: () => [rect(35, 52, 90, 18)],
    } as unknown as Range)

    await captureScreenshot()

    expect(context.fillRect).toHaveBeenCalledWith(33, 50, 94, 22)
    expect(context.fillRect).toHaveBeenCalledWith(38, 88, 204, 36)
    expect(context.fillRect).not.toHaveBeenCalledWith(30, 40, 600, 240)
  })

  it('covers built-in sensitive fields and high-confidence secrets in page content', async () => {
    const context = mockCanvasContext()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1280, 3000))

    const password = document.createElement('input')
    password.type = 'password'
    password.value = 'hunter2'
    vi.spyOn(password, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 180, 32))
    const card = document.createElement('input')
    card.name = 'notes'
    card.value = '4242 4242 4242 4242'
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(10, 70, 240, 32))
    const ordinary = document.createElement('input')
    ordinary.name = 'notes'
    ordinary.value = 'export is slow'
    vi.spyOn(ordinary, 'getBoundingClientRect').mockReturnValue(rect(10, 120, 240, 32))
    const secretText = document.createTextNode('Key sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    const ordinaryText = document.createTextNode('Order 1234 is delayed')
    document.body.append(password, card, ordinary, secretText, ordinaryText)

    let selectedNode: Node | null = null
    vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: (node: Node) => { selectedNode = node },
      getClientRects: () => selectedNode === secretText ? [rect(300, 200, 280, 18)] : [],
    } as unknown as Range)

    await captureScreenshot()

    expect(context.fillRect).toHaveBeenCalledWith(8, 18, 184, 36)
    expect(context.fillRect).toHaveBeenCalledWith(8, 68, 244, 36)
    expect(context.fillRect).toHaveBeenCalledWith(298, 198, 284, 22)
    expect(context.fillRect).not.toHaveBeenCalledWith(8, 118, 244, 36)
  })

  it('covers privacy regions at viewport coordinates when the page is scrolled', async () => {
    const context = mockCanvasContext()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, -1200, 1280, 3000))
    const blocked = document.createElement('section')
    blocked.className = 'rr-block'
    vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(25, 40, 320, 180))
    const password = document.createElement('input')
    password.type = 'password'
    password.value = 'hunter2'
    vi.spyOn(password, 'getBoundingClientRect').mockReturnValue(rect(10, 300, 180, 32))
    document.body.append(blocked, password)

    await captureScreenshot()

    // The capture is the viewport itself, shifted into place by the clone's
    // transform — so a cover measured from the live viewport rect is already in
    // capture coordinates. Adding the page scroll back (the full-page mapping)
    // would push every cover 1200px past the secret it must hide.
    const options = toJpegMock.mock.calls[0][1] as { style?: Record<string, string> }
    expect(options.style?.['transform']).toBe('translate(0px, -1200px)')
    expect(context.fillRect).toHaveBeenCalledWith(25, 40, 320, 180)
    expect(context.fillRect).toHaveBeenCalledWith(8, 298, 184, 36)
    expect(context.fillRect).not.toHaveBeenCalledWith(25, 1240, 320, 180)
  })

  it('measures privacy covers after the font warm-up so a layout shift during it cannot misplace them', async () => {
    vi.resetModules()
    const htmlToImage = await import('html-to-image')
    let resolveFontWarmUp!: (css: string) => void
    vi.mocked(htmlToImage.getFontEmbedCSS).mockReturnValue(
      new Promise(resolve => { resolveFontWarmUp = resolve }),
    )
    const { captureScreenshot: freshCaptureScreenshot } = await import('./capture')

    const context = mockCanvasContext()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1280, 3000))
    const blocked = document.createElement('section')
    blocked.className = 'rr-block'
    const blockedRect = vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(25, 40, 320, 180))
    document.body.appendChild(blocked)

    const capture = freshCaptureScreenshot()
    // Late-arriving fonts reflow the page while the warm-up is in flight; a
    // cover measured before that shift exports the secret uncovered.
    blockedRect.mockReturnValue(rect(25, 640, 320, 180))
    resolveFontWarmUp('')
    await capture

    expect(context.fillRect).toHaveBeenCalledWith(25, 640, 320, 180)
    expect(context.fillRect).not.toHaveBeenCalledWith(25, 40, 320, 180)
  })

  it('returns null when drawing a privacy cover fails', async () => {
    const context = mockCanvasContext()
    context.fillRect.mockImplementation(() => { throw new Error('canvas failed') })
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    const blocked = document.createElement('section')
    blocked.className = 'rr-block'
    vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(25, 40, 320, 180))
    document.body.appendChild(blocked)

    await expect(captureScreenshot()).resolves.toBeNull()
  })

  it('returns null when a privacy region has invalid geometry', async () => {
    const blocked = document.createElement('section')
    blocked.className = 'rr-block'
    vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(Number.NaN, 40, 320, 180))
    document.body.appendChild(blocked)

    await expect(captureScreenshot()).resolves.toBeNull()
  })

  // No captureOffset on the annotation — the shape every client sent before
  // 1.22, and what replayed data still looks like. The capture-time path has to
  // keep working for it, so this and the two unanchored cases in the nested
  // scroller below are the backward-compatibility guard.
  it('maps unanchored annotations and redactions 1:1 onto the scrolled viewport capture', async () => {
    const sourceContext = mockCanvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => sourceContext as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
    })
    vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
    vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: -1200,
      top: -1200,
      right: 1280,
      bottom: 1800,
      left: 0,
      width: 1280,
      height: 3000,
      toJSON: () => ({}),
    })
    vi.stubGlobal('Image', ViewportImage)
    const blocked = document.createElement('section')
    blocked.className = 'rr-block'
    vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 300, 120))
    document.body.appendChild(blocked)

    await captureScreenshot([{ type: 'pin', x: 640, y: 360 }])

    // The capture is the viewport itself, so viewport coordinates need no
    // scroll translation — the clone was shifted instead.
    const options = toJpegMock.mock.calls[0][1] as { style?: Record<string, string> }
    expect(options.style?.['transform']).toBe('translate(0px, -1200px)')
    expect(sourceContext.fillRect).toHaveBeenCalledWith(100, 200, 300, 120)
    expect(sourceContext.arc).toHaveBeenCalledWith(640, 360, 11, 0, Math.PI * 2)
  })

  // An annotation is fixed the moment it is made. Whatever the reporter scrolls
  // past on the way to the submit button — the page itself or a container
  // inside it — the mark must stay on the content it was made over.
  describe('when the page scrolls between annotating and capturing', () => {
    function prepareCapture(scrollY: number) {
      const sourceContext = mockCanvasContext()
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => sourceContext as unknown as CanvasRenderingContext2D,
      )
      const exportedCanvasSizes: string[] = []
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
      ) {
        exportedCanvasSizes.push(`${this.width}x${this.height}`)
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
      })
      vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
      vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(3000)
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720)
      vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0)
      vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollY)
      vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, -scrollY, 1280, 3000))
      vi.stubGlobal('Image', ViewportImage)

      return { sourceContext, exportedCanvasSizes }
    }

    // Made near the top of the page, 360px down the viewport, with the page
    // still unscrolled — so the mark sits 360px into the document.
    const annotation = { type: 'pin' as const, x: 640, y: 360, captureOffsetX: 0, captureOffsetY: 0 }

    it('follows its content up the bitmap when the page scrolls a little', async () => {
      const { sourceContext } = prepareCapture(200)

      await captureScreenshot([annotation])

      // The document point at 360 sits 160px down a viewport scrolled to 200.
      expect(sourceContext.arc).toHaveBeenCalledWith(640, 160, 11, 0, Math.PI * 2)
    })

    // The capture is one viewport — the one on screen at capture time. A mark
    // whose content has been scrolled past the captured rect is honestly not in
    // the shot: its coordinates land off-canvas and the canvas clips them. The
    // wire annotation still carries the mark; only the bitmap omits it.
    it('omits a mark the page has scrolled out of the captured viewport', async () => {
      const { sourceContext, exportedCanvasSizes } = prepareCapture(1200)

      await captureScreenshot([annotation])

      // 360 into the document is 840px above a viewport scrolled to 1200.
      expect(sourceContext.arc).toHaveBeenCalledWith(640, -840, 11, 0, Math.PI * 2)
      // And the export must stay the whole captured viewport: chasing the mark
      // with a crop is what used to shift the remaining content and blank the
      // shot.
      expect(exportedCanvasSizes).toEqual(['1280x720'])
    })

    // Both scrolls at once, in opposite directions, so no single-term mistake
    // survives: the mark was made 350px down the viewport with the page at 200
    // and its container at 180, which puts it 730px down the clone. The page
    // has since moved to 500 — where the clone point 730 renders 230px down
    // the captured viewport — and the container is back at the top.
    it('holds its place when the page and the container it sits in both scroll', async () => {
      const { sourceContext } = prepareCapture(500)
      document.body.innerHTML = '<main id="scroller"><input id="target"></main>'

      await captureScreenshot([{
        type: 'pin', x: 600, y: 350, targetSelector: '#target',
        captureOffsetX: 0, captureOffsetY: 380,
      }])

      expect(sourceContext.arc).toHaveBeenCalledWith(600, 230, 11, 0, Math.PI * 2)
    })

    it('stays glued to the same document point whichever scroll the capture ran at', async () => {
      const anchored = { type: 'pin' as const, x: 640, y: 360, captureOffsetX: 0, captureOffsetY: 600 }
      const first = prepareCapture(600)
      await captureScreenshot([anchored])
      // Read before restoring: restoring clears what the mocks recorded.
      const firstY = first.sourceContext.arc.mock.calls[0]?.[1] as number
      vi.restoreAllMocks()
      const second = prepareCapture(400)
      await captureScreenshot([anchored])
      const secondY = second.sourceContext.arc.mock.calls[0]?.[1] as number

      // Bitmap position + capture scroll = the document point the reporter
      // marked; that sum must not depend on when the capture ran.
      expect(firstY).toBe(360)
      expect(firstY + 600).toBe(secondY + 400)
    })
  })

  describe('inside a nested scroller', () => {
    function prepareCapture() {
      const sourceContext = mockCanvasContext()
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => sourceContext as unknown as CanvasRenderingContext2D,
      )
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
      })
      vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1280)
      vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(720)
      vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        right: 1280,
        bottom: 720,
        left: 0,
        width: 1280,
        height: 720,
        toJSON: () => ({}),
      })
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720)
      vi.stubGlobal('Image', ViewportImage)

      document.body.innerHTML = '<main id="scroller"><input id="target"></main>'
      const scroller = document.querySelector<HTMLElement>('#scroller')!
      Object.defineProperty(scroller, 'scrollTop', { value: 180, configurable: true })

      return { sourceContext }
    }

    const targetRect = { top: 330, left: 500, width: 200, height: 40, bottom: 370 }

    it('moves a pin with its target when the target is inside a scrolled container', async () => {
      const { sourceContext } = prepareCapture()

      await captureScreenshot([{
        type: 'pin', x: 600, y: 350, targetSelector: '#target', targetRect,
      }])

      expect(sourceContext.arc).toHaveBeenCalledWith(600, 530, 11, 0, Math.PI * 2)
    })

    it('holds a pin at its target when the container scrolls after the annotation', async () => {
      const { sourceContext } = prepareCapture()
      // The reporter marked the target while the container sat at 180, then
      // scrolled it back to the top before submitting.
      const scroller = document.querySelector<HTMLElement>('#scroller')!
      Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true })

      await captureScreenshot([{
        type: 'pin', x: 600, y: 350, targetSelector: '#target', targetRect,
        captureOffsetX: 0, captureOffsetY: 180,
      }])

      expect(sourceContext.arc).toHaveBeenCalledWith(600, 530, 11, 0, Math.PI * 2)
    })

    it('moves every point in a drawing with its target inside a scrolled container', async () => {
      const { sourceContext } = prepareCapture()

      await captureScreenshot([{
        type: 'draw', x: 620, y: 360, targetSelector: '#target', targetRect,
        drawPath: 'M 600 350 L 640 390',
      }])

      expect(sourceContext.moveTo).toHaveBeenCalledWith(600, 530)
      expect(sourceContext.lineTo).toHaveBeenCalledWith(640, 570)
    })

    // Same expected pixels as the drawing above, which is the point: whether
    // the container is still scrolled or has been put back, the stroke stays on
    // what it was drawn over.
    it('holds a drawing at its target when the container scrolls after the annotation', async () => {
      const { sourceContext } = prepareCapture()
      const scroller = document.querySelector<HTMLElement>('#scroller')!
      Object.defineProperty(scroller, 'scrollTop', { value: 0, configurable: true })

      await captureScreenshot([{
        type: 'draw', x: 620, y: 360, targetSelector: '#target', targetRect,
        drawPath: 'M 600 350 L 640 390',
        captureOffsetX: 0, captureOffsetY: 180,
      }])

      expect(sourceContext.moveTo).toHaveBeenCalledWith(600, 530)
      expect(sourceContext.lineTo).toHaveBeenCalledWith(640, 570)
    })

    it('covers rr-block regions, sensitive fields, and secret text at the clone coordinates', async () => {
      const { sourceContext } = prepareCapture()
      const scroller = document.querySelector<HTMLElement>('#scroller')!
      const blocked = document.createElement('section')
      blocked.className = 'rr-block'
      vi.spyOn(blocked, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 300, 120))
      const password = document.createElement('input')
      password.type = 'password'
      password.value = 'hunter2'
      vi.spyOn(password, 'getBoundingClientRect').mockReturnValue(rect(500, 330, 200, 40))
      const secretText = document.createTextNode('Key sk-proj-abcdefghijklmnopqrstuvwxyz123456')
      scroller.append(blocked, password, secretText)
      let selectedNode: Node | null = null
      vi.spyOn(document, 'createRange').mockReturnValue({
        selectNodeContents: (node: Node) => { selectedNode = node },
        getClientRects: () => selectedNode === secretText ? [rect(300, 250, 280, 18)] : [],
      } as unknown as Range)

      await captureScreenshot()

      // The clone renders the scroller's children 180px lower than the live
      // viewport rects report; a cover at the raw rect would leave the secret
      // fully visible in the export.
      expect(sourceContext.fillRect).toHaveBeenCalledWith(100, 380, 300, 120)
      expect(sourceContext.fillRect).toHaveBeenCalledWith(498, 508, 204, 44)
      expect(sourceContext.fillRect).toHaveBeenCalledWith(298, 428, 284, 22)
      expect(sourceContext.fillRect).not.toHaveBeenCalledWith(100, 200, 300, 120)
      expect(sourceContext.fillRect).not.toHaveBeenCalledWith(498, 328, 204, 44)
    })

    it('exports the whole viewport bitmap even when the scrolled annotation falls outside it', async () => {
      const exportedCanvasSizes: string[] = []
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
      ) {
        exportedCanvasSizes.push(`${this.width}x${this.height}`)
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
      })
      vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1920)
      vi.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(1080)
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920)
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1080)
      vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1920, 1080))
      vi.stubGlobal('Image', DesktopViewportImage)

      document.body.innerHTML = '<main id="scroller"><input id="target"></main>'
      const scroller = document.querySelector<HTMLElement>('#scroller')!
      Object.defineProperty(scroller, 'scrollTop', { value: 632, configurable: true })

      await captureScreenshot([{
        type: 'pin',
        x: 876.67578125,
        y: 622.16796875,
        targetSelector: '#target',
        targetRect: { top: 613.5, left: 864.7265625, width: 20, bottom: 633.5, height: 20 },
      }])

      expect(exportedCanvasSizes).toEqual(['1920x1080'])
    })
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

class ImmediatelyLoadingImage {
  naturalWidth = 1280
  naturalHeight = 3000
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

class ViewportImage {
  naturalWidth = 1280
  naturalHeight = 720
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

class DesktopViewportImage {
  naturalWidth = 1920
  naturalHeight = 1080
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

function mockCanvasContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
  }
}

function trackStyleAssignments(
  context: ReturnType<typeof mockCanvasContext>,
  property: 'fillStyle' | 'shadowColor' | 'strokeStyle',
): string[] {
  const values: string[] = []
  Object.defineProperty(context, property, {
    configurable: true,
    get: () => values[values.length - 1],
    set: (value: string) => values.push(value),
  })
  return values
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}
