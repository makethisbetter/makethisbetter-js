import { afterEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { AnnotationOverlay } from './overlay'

describe('AnnotationOverlay', () => {
  let shadow: ShadowContainer
  let handlers: {
    onMouseDown: ReturnType<typeof vi.fn>
    onMouseMove: ReturnType<typeof vi.fn>
    onMouseUp: ReturnType<typeof vi.fn>
    onMouseLeave: ReturnType<typeof vi.fn>
  }
  let overlay: AnnotationOverlay

  function setup() {
    shadow = new ShadowContainer()
    handlers = {
      onMouseDown: vi.fn(),
      onMouseMove: vi.fn(),
      onMouseUp: vi.fn(),
      onMouseLeave: vi.fn(),
    }
    overlay = new AnnotationOverlay(shadow, handlers)
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

  describe('mouse event handlers', () => {
    it('dispatches mousedown to the handler', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      expect(handlers.onMouseDown).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    it('dispatches mousemove to the handler', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      expect(handlers.onMouseMove).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    it('dispatches mouseup to the handler', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      expect(handlers.onMouseUp).toHaveBeenCalledOnce()
      overlay.destroy()
    })

    it('dispatches mouseleave to the handler', () => {
      setup()
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlayEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
      expect(handlers.onMouseLeave).toHaveBeenCalledOnce()
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
      const overlayEl = shadow.root.querySelector('.mtb-overlay')!
      overlay.destroy()

      handlers.onMouseDown.mockClear()
      overlayEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      expect(handlers.onMouseDown).not.toHaveBeenCalled()
    })
  })
})
