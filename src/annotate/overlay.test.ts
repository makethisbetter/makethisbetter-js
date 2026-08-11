import { afterEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { AnnotationOverlay } from './overlay'

describe('AnnotationOverlay', () => {
  let shadow: ShadowContainer
  let handlers: {
    onPointerDown: ReturnType<typeof vi.fn>
    onPointerMove: ReturnType<typeof vi.fn>
    onPointerUp: ReturnType<typeof vi.fn>
    onPointerCancel: ReturnType<typeof vi.fn>
  }
  let overlay: AnnotationOverlay

  function setup() {
    shadow = new ShadowContainer()
    handlers = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
    }
    overlay = new AnnotationOverlay(shadow, handlers)
  }

  function overlayEl(): HTMLDivElement {
    return shadow.root.querySelector('.mtb-overlay')!
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('creates overlay and dim elements in the shadow root', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-overlay')).toBeInstanceOf(HTMLDivElement)
      expect(shadow.root.querySelector('.mtb-dim')).toBeInstanceOf(HTMLDivElement)
      overlay.destroy()
    })
  })

  describe('pointer event handlers', () => {
    it('dispatches pointerdown to the handler', () => {
      setup()
      overlayEl().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(handlers.onPointerDown).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    it('dispatches pointermove to the handler', () => {
      setup()
      overlayEl().dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      expect(handlers.onPointerMove).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    it('dispatches pointerup to the handler', () => {
      setup()
      overlayEl().dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      expect(handlers.onPointerUp).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    it('dispatches pointercancel to the handler', () => {
      setup()
      overlayEl().dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
      expect(handlers.onPointerCancel).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    // Mouse listeners are gone on purpose: on touch devices a tap fires
    // pointerdown/up AND the compatibility mousedown/up, which would run the
    // annotation logic twice and drop two pins for one tap.
    it('ignores compatibility mouse events', () => {
      setup()
      overlayEl().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      overlayEl().dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      overlayEl().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      expect(handlers.onPointerDown).not.toHaveBeenCalled()
      expect(handlers.onPointerMove).not.toHaveBeenCalled()
      expect(handlers.onPointerUp).not.toHaveBeenCalled()
      overlay.destroy()
    })
  })

  describe('secondary pointers', () => {
    it('ignores a non-primary pointer so pinch-zoom does not draw', () => {
      setup()
      overlayEl().dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, isPrimary: false }),
      )
      expect(handlers.onPointerDown).not.toHaveBeenCalled()
      overlay.destroy()
    })

    // A palm or second finger can be cancelled on its own. That pointer never
    // reached the handlers, so letting its cancel through would cut short a
    // stroke the primary finger is still drawing — the line vanishes and
    // degrades into a pin.
    it('ignores a non-primary cancel so it cannot end the primary stroke', () => {
      setup()
      const el = overlayEl()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el.dispatchEvent(
        new PointerEvent('pointercancel', { bubbles: true, pointerId: 2, isPrimary: false }),
      )
      expect(handlers.onPointerCancel).not.toHaveBeenCalled()
      overlay.destroy()
    })

    it('still honours a cancel for the primary pointer', () => {
      setup()
      const el = overlayEl()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
      expect(handlers.onPointerCancel).toHaveBeenCalledOnce()
      overlay.destroy()
    })
  })

  describe('pointer capture', () => {
    it('captures the pointer on pointerdown so a stroke survives leaving the overlay', () => {
      setup()
      const el = overlayEl()
      const capture = vi.spyOn(el, 'setPointerCapture')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }))
      expect(capture).toHaveBeenCalledWith(7)
      overlay.destroy()
    })

    it('releases the pointer on pointerup', () => {
      setup()
      const el = overlayEl()
      const release = vi.spyOn(el, 'releasePointerCapture')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))
      expect(release).toHaveBeenCalledWith(7)
      overlay.destroy()
    })
  })

  describe('destroy', () => {
    it('removes overlay and dim elements from the shadow root', () => {
      setup()
      overlay.destroy()
      expect(shadow.root.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.root.querySelector('.mtb-dim')).toBeNull()
    })

    it('removes event listeners so handlers are not called after destroy', () => {
      setup()
      const el = overlayEl()
      overlay.destroy()

      handlers.onPointerDown.mockClear()
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      expect(handlers.onPointerDown).not.toHaveBeenCalled()
    })
  })
})
