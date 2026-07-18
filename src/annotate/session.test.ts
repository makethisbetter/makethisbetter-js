import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { AnnotationSession } from './session'
import { getMessages } from '../i18n'

const SVG_SEL = 'svg[class="mtb-draw-svg"]'

describe('AnnotationSession', () => {
  let shadow: ShadowContainer
  let session: AnnotationSession
  let onReady: ReturnType<typeof vi.fn>
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
    onReady = vi.fn()
    session = new AnnotationSession(shadow, messages, onReady)
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
    it('creates a pin annotation on mousedown + mouseup with fewer than 5 points', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 100, clientY: 200, bubbles: true }),
      )
      overlayEl.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 100, clientY: 200, bubbles: true }),
      )

      expect(onReady).toHaveBeenCalledOnce()
      const [annotation] = onReady.mock.calls[0]
      expect(annotation.type).toBe('pin')
      expect(annotation.x).toBe(100)
      expect(annotation.y).toBe(200)
      session.destroy()
    })

    it('adds a pin marker to the shadow root', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }),
      )
      overlayEl.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }),
      )

      const pin = shadow.root.querySelector('.mtb-pin')
      expect(pin).toBeInstanceOf(HTMLDivElement)
      expect(pin!.textContent).toBe('1')
      session.destroy()
    })

    it('increments pin count on successive clicks', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      for (let i = 0; i < 3; i++) {
        overlayEl.dispatchEvent(
          new MouseEvent('mousedown', { clientX: 10 * i, clientY: 10 * i, bubbles: true }),
        )
        overlayEl.dispatchEvent(
          new MouseEvent('mouseup', { clientX: 10 * i, clientY: 10 * i, bubbles: true }),
        )
      }

      const pins = shadow.root.querySelectorAll('.mtb-pin')
      expect(pins.length).toBe(3)
      expect(pins[0].textContent).toBe('1')
      expect(pins[1].textContent).toBe('2')
      expect(pins[2].textContent).toBe('3')
      session.destroy()
    })

    it('uses element name from elementsFromPoint when an element is found', () => {
      setup()
      const btn = document.createElement('button')
      btn.setAttribute('aria-label', 'Save')
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([btn])

      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }),
      )
      overlayEl.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }),
      )

      const [annotation, targetName] = onReady.mock.calls[0]
      expect(targetName).toBe('Save')
      expect(annotation.targetName).toBe('Save')
      session.destroy()
    })

    it('falls back to messages.annotation.element when no element under cursor', () => {
      setup()
      ;(document.elementsFromPoint as ReturnType<typeof vi.fn>).mockReturnValue([])

      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }),
      )
      overlayEl.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }),
      )

      const [, targetName] = onReady.mock.calls[0]
      expect(targetName).toBe(messages.annotation.element)
      session.destroy()
    })
  })

  describe('draw annotation via drag', () => {
    it('creates a draw annotation when enough points are collected', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }),
      )
      for (let i = 1; i <= 5; i++) {
        overlayEl.dispatchEvent(
          new MouseEvent('mousemove', { clientX: i * 10, clientY: i * 10, bubbles: true }),
        )
      }
      overlayEl.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }),
      )

      expect(onReady).toHaveBeenCalledOnce()
      const [annotation, targetName] = onReady.mock.calls[0]
      expect(annotation.type).toBe('draw')
      expect(annotation.drawPath).toBeDefined()
      expect(targetName).toBe(messages.annotation.drawing)
      session.destroy()
    })
  })

  describe('mouseleave', () => {
    it('ends drawing when mouse leaves the overlay', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }),
      )
      for (let i = 1; i <= 5; i++) {
        overlayEl.dispatchEvent(
          new MouseEvent('mousemove', { clientX: i * 10, clientY: i * 10, bubbles: true }),
        )
      }
      overlayEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))

      expect(onReady).toHaveBeenCalledOnce()
      session.destroy()
    })
  })

  describe('hover highlight', () => {
    it('coalesces mousemove hit tests into one per animation frame with the latest coordinates', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      for (let i = 1; i <= 5; i++) {
        overlayEl.dispatchEvent(
          new MouseEvent('mousemove', { clientX: i * 10, clientY: i * 10, bubbles: true }),
        )
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

      overlayEl.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }),
      )
      flushFrame()

      const highlightEl = shadow.root.querySelector<HTMLDivElement>('.mtb-highlight')!
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

      overlayEl.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }),
      )
      overlayEl.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }),
      )

      const [, targetName] = onReady.mock.calls[0]
      expect(targetName).toBe('Save')
      session.destroy()
    })

    it('does not toggle the widget host display during hit testing', () => {
      setup()
      const hostEl = document.getElementById('mtb-widget-host')!
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }),
      )
      flushFrame()

      expect(hostEl.style.display).toBe('')
      session.destroy()
    })

    it('cancels a pending highlight when the mouse leaves the overlay', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }),
      )
      overlayEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
      flushFrame()

      expect(document.elementsFromPoint).not.toHaveBeenCalled()
      session.destroy()
    })

    it('cancels a pending highlight on dismissInteraction', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!

      overlayEl.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }),
      )
      session.dismissInteraction()
      flushFrame()

      expect(document.elementsFromPoint).not.toHaveBeenCalled()
      session.destroy()
    })
  })

  describe('dismissInteraction', () => {
    it('removes overlay and highlighter but keeps pins and draw layer', () => {
      setup()
      session.dismissInteraction()

      expect(shadow.root.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.root.querySelector('.mtb-highlight')).toBeNull()
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
