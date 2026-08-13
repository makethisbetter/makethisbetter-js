import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { AnnotationSession } from './session'
import { getMessages } from '../i18n'

const SVG_SEL = 'svg[class="mtb-draw-svg"]'

describe('AnnotationSession', () => {
  let shadow: ShadowContainer
  let session: AnnotationSession
  let onPin: ReturnType<typeof vi.fn>
  let onDrawStroke: ReturnType<typeof vi.fn>
  const messages = getMessages('en')

  let rafQueue: FrameRequestCallback[]

  beforeEach(() => {
    // jsdom does not implement elementsFromPoint — stub it
    document.elementsFromPoint = vi.fn().mockReturnValue([])
    rafQueue = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => rafQueue.push(cb)))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      rafQueue.splice(id - 1, 1)
    }))
  })

  function setup() {
    shadow = new ShadowContainer()
    onPin = vi.fn()
    onDrawStroke = vi.fn()
    session = new AnnotationSession(shadow, messages, { onPin, onDrawStroke })
  }

  function drag(overlayEl: Element, points: number): void {
    overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }))
    for (let i = 1; i < points; i++) {
      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: i * 10, clientY: i * 10, bubbles: true }))
    }
    overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: (points - 1) * 10, clientY: (points - 1) * 10, bubbles: true }))
  }

  function flushFrame() {
    const queue = rafQueue
    rafQueue = []
    queue.forEach(cb => cb(0))
  }

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('constructor', () => {
    it('creates overlay, highlighter, pin, and draw elements in shadow root', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-overlay')).toBeInstanceOf(HTMLDivElement)
      expect(shadow.root.querySelector('.mtb-highlight')).toBeInstanceOf(HTMLDivElement)
      expect(shadow.root.querySelector(SVG_SEL)).toBeTruthy()
      expect(shadow.root.querySelector('.mtb-dim')).toBeInstanceOf(HTMLDivElement)
      session.destroy()
    })
  })

  describe('pin annotation via short click', () => {
    it('creates a pin annotation on pointerdown + pointerup with fewer than 5 points', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 200, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 200, bubbles: true }))

      expect(onPin).toHaveBeenCalledOnce()
      expect(onDrawStroke).not.toHaveBeenCalled()
      const [annotation] = onPin.mock.calls[0]
      expect(annotation.type).toBe('pin')
      expect(annotation.x).toBe(100)
      expect(annotation.y).toBe(200)
      session.destroy()
    })

    // A mouse click emits no pointermove at all; a finger never holds still,
    // so a tap arrives as a handful of moves within a pixel or two. Counting
    // points made every tap on a phone cross the stroke threshold, which is
    // why annotating by tapping did nothing but open the draw bar.
    it('treats a jittery finger tap as a pin, not a stroke', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      const jitter = [[100, 200], [101, 200], [101, 201], [100, 201], [101, 200], [100, 200]]

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 200, bubbles: true }))
      for (const [x, y] of jitter) {
        overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
      }
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 200, bubbles: true }))

      expect(onPin).toHaveBeenCalledOnce()
      expect(onDrawStroke).not.toHaveBeenCalled()
      session.destroy()
    })

    it('still treats a deliberate short drag as a stroke', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 200, bubbles: true }))
      for (let i = 1; i <= 4; i++) {
        overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + i * 6, clientY: 200, bubbles: true }))
      }
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 124, clientY: 200, bubbles: true }))

      expect(onDrawStroke).toHaveBeenCalledOnce()
      expect(onPin).not.toHaveBeenCalled()
      session.destroy()
    })

    // The pin's x/y are viewport coordinates, which stop meaning anything the
    // moment the reporter scrolls. What fixes them is the scroll they were read
    // against — every scroller between the marked element and the page, plus
    // the page itself — recorded in the same breath as the coordinates.
    it('records the page and container scroll the pin was made against', () => {
      setup()
      document.body.innerHTML = '<main id="scroller"><button id="target">Save</button></main>'
      const scroller = document.querySelector<HTMLElement>('#scroller')!
      Object.defineProperty(scroller, 'scrollTop', { value: 180, configurable: true })
      document.elementsFromPoint = vi.fn().mockReturnValue([document.querySelector('#target')])
      vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0)
      vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200)
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 600, clientY: 350, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 600, clientY: 350, bubbles: true }))

      const [annotation] = onPin.mock.calls[0]
      expect(annotation.captureOffsetX).toBe(0)
      expect(annotation.captureOffsetY).toBe(380)
      session.destroy()
    })

    it('adds a pin marker to the shadow root', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))

      const pin = shadow.root.querySelector('.mtb-pin')
      expect(pin).toBeInstanceOf(HTMLDivElement)
      session.destroy()
    })

    it('adds multiple pins on successive clicks', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      for (let i = 0; i < 3; i++) {
        overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10 * i, clientY: 10 * i, bubbles: true }))
        overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 10 * i, clientY: 10 * i, bubbles: true }))
      }

      const pins = shadow.root.querySelectorAll('.mtb-pin')
      expect(pins.length).toBe(3)
      session.destroy()
    })

    it('uses element name from elementsFromPoint when an element is found', () => {
      setup()
      const btn = document.createElement('button')
      btn.setAttribute('aria-label', 'Save')
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([btn])

      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))

      const [annotation, targetName] = onPin.mock.calls[0]
      expect(targetName).toBe('Save')
      expect(annotation.targetName).toBe('Save')
      session.destroy()
    })

    it.each(['rr-block', 'rr-mask'])('keeps a pin inside a %s region structural', (cls) => {
      setup()
      const region = document.createElement('div')
      region.className = cls
      const button = document.createElement('button')
      button.id = 'patient-jane-doe'
      button.setAttribute('aria-label', 'Reveal token secret')
      button.textContent = 'Card 4242 4242 4242 4242'
      region.appendChild(button)
      document.body.appendChild(region)
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([button])

      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))

      const [annotation, targetName] = onPin.mock.calls[0]
      expect(targetName).toBe('button')
      expect(annotation.targetName).toBe('button')
      expect(annotation.targetText).toBe('')
      expect(annotation.targetSelector).toBe('button')
      session.destroy()
    })

    it('falls back to messages.annotation.element when no element under cursor', () => {
      setup()
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([])

      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))

      const [, targetName] = onPin.mock.calls[0]
      expect(targetName).toBe(messages.annotation.element)
      session.destroy()
    })
  })

  describe('draw annotation via drag', () => {
    it('commits a stroke and notifies onDrawStroke when enough points are collected', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      drag(overlayEl, 6)

      expect(onDrawStroke).toHaveBeenCalledOnce()
      expect(onPin).not.toHaveBeenCalled()
      expect(session.hasDrawStrokes()).toBe(true)
      const annotation = session.getDrawAnnotation()
      expect(annotation?.type).toBe('draw')
      expect(annotation?.drawPath).toBeDefined()
      session.destroy()
    })

    it('keeps a draw target inside a marked ancestor structural', () => {
      setup()
      const region = document.createElement('div')
      region.className = 'rr-mask'
      const cell = document.createElement('span')
      cell.id = 'patient-jane-doe'
      cell.setAttribute('role', 'gridcell')
      cell.textContent = 'Token secret'
      region.appendChild(cell)
      document.body.appendChild(region)
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([cell])
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      drag(overlayEl, 6)

      const annotation = session.getDrawAnnotation()
      expect(annotation?.targetName).toBe('gridcell')
      expect(annotation?.targetText).toBe('')
      expect(annotation?.targetSelector).toBe('span')
      session.destroy()
    })

    it('supports undo and redo of committed strokes', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      drag(overlayEl, 6)

      expect(session.canUndoDraw()).toBe(true)
      expect(session.canRedoDraw()).toBe(false)

      session.undoDraw()
      expect(session.hasDrawStrokes()).toBe(false)
      expect(session.canRedoDraw()).toBe(true)

      session.redoDraw()
      expect(session.hasDrawStrokes()).toBe(true)
      session.destroy()
    })

    it('ignores stray short clicks once strokes exist (no pin)', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      drag(overlayEl, 6)
      onDrawStroke.mockClear()

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 200, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 200, bubbles: true }))

      expect(onPin).not.toHaveBeenCalled()
      expect(onDrawStroke).not.toHaveBeenCalled()
      session.destroy()
    })

    it('clearDraw removes all committed strokes', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      drag(overlayEl, 6)
      session.clearDraw()
      expect(session.hasDrawStrokes()).toBe(false)
      expect(session.getDrawAnnotation()).toBeNull()
      session.destroy()
    })
  })

  describe('pointercancel', () => {
    it('commits an in-progress stroke when the mouse leaves the overlay', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }))
      for (let i = 1; i <= 5; i++) {
        overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: i * 10, clientY: i * 10, bubbles: true }))
      }
      overlayEl.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))

      expect(onDrawStroke).toHaveBeenCalledOnce()
      session.destroy()
    })
  })

  describe('hover highlight', () => {
    it('coalesces mousemove hit tests into one per animation frame with the latest coordinates', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      for (let i = 1; i <= 5; i++) {
        overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: i * 10, clientY: i * 10, bubbles: true }))
      }

      expect(document.elementsFromPoint).not.toHaveBeenCalled()
      flushFrame()
      expect(document.elementsFromPoint).toHaveBeenCalledOnce()
      expect(document.elementsFromPoint).toHaveBeenCalledWith(50, 50)
      session.destroy()
    })

    it('shows the highlight box over the element under the cursor', () => {
      setup()
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([btn])
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }))
      flushFrame()

      const highlightEl = shadow.root.querySelector<HTMLDivElement>('.mtb-highlight')!
      expect(highlightEl.style.display).toBe('block')
      session.destroy()
    })

    it('suppresses hover highlight while a draw session is active, resumes after clearDraw', () => {
      setup()
      const btn = document.createElement('button')
      document.body.appendChild(btn)
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([btn])
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      const highlightEl = shadow.root.querySelector<HTMLDivElement>('.mtb-highlight')!

      drag(overlayEl, 8)
      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }))
      flushFrame()
      expect(highlightEl.style.display).not.toBe('block')

      session.undoDraw()
      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 12, clientY: 12, bubbles: true }))
      flushFrame()
      expect(highlightEl.style.display).not.toBe('block')

      session.clearDraw()
      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 14, clientY: 14, bubbles: true }))
      flushFrame()
      expect(highlightEl.style.display).toBe('block')
      session.destroy()
    })

    it('ignores the widget host when resolving the element under the cursor', () => {
      setup()
      const hostEl = document.getElementById('mtb-widget-host')!
      const btn = document.createElement('button')
      btn.setAttribute('aria-label', 'Save')
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([hostEl, btn])
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))

      const [, targetName] = onPin.mock.calls[0]
      expect(targetName).toBe('Save')
      session.destroy()
    })

    it('cancels a pending highlight when the mouse leaves the overlay', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }))
      overlayEl.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
      flushFrame()

      expect(document.elementsFromPoint).not.toHaveBeenCalled()
      session.destroy()
    })

    it('cancels a pending highlight on dismissInteraction', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }))
      session.dismissInteraction()
      flushFrame()

      expect(document.elementsFromPoint).not.toHaveBeenCalled()
      session.destroy()
    })
  })

  describe('dismissInteraction', () => {
    it('removes overlay but keeps highlighter, pins, and draw layer', () => {
      setup()
      session.dismissInteraction()

      expect(shadow.root.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.root.querySelector('.mtb-highlight')).toBeTruthy()
      expect(shadow.root.querySelector(SVG_SEL)).toBeTruthy()
      session.destroy()
    })

    it('is idempotent — second call does not throw', () => {
      setup()
      session.dismissInteraction()
      expect(() => session.dismissInteraction()).not.toThrow()
      session.destroy()
    })
  })

  describe('destroy', () => {
    it('removes all elements from the shadow root', () => {
      setup()
      session.destroy()

      expect(shadow.root.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.root.querySelector('.mtb-highlight')).toBeNull()
      expect(shadow.root.querySelector('.mtb-pin')).toBeNull()
      expect(shadow.root.querySelector(SVG_SEL)).toBeNull()
    })

    it('is safe to call after dismissInteraction', () => {
      setup()
      session.dismissInteraction()
      expect(() => session.destroy()).not.toThrow()
    })
  })
})
