import type { ShadowContainer } from '../widget/shadow'

export interface OverlayHandlers {
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerCancel: (e: PointerEvent) => void
}

/**
 * The annotation surface. Runs on pointer events only — never mouse events.
 *
 * Mouse listeners are deliberately absent. Touch browsers replay a tap as
 * pointerdown/up followed by compatibility mousedown/up/click, so listening to
 * both would run the annotation logic twice for one tap and drop two pins.
 * Pointer events already cover mouse and stylus, so the desktop loses nothing.
 */
export class AnnotationOverlay {
  private overlayEl: HTMLDivElement
  private dimEl: HTMLDivElement
  private handlers: OverlayHandlers
  private onPointerDown: (e: Event) => void
  private onPointerMove: (e: Event) => void
  private onPointerUp: (e: Event) => void
  private onPointerCancel: (e: Event) => void

  constructor(shadow: ShadowContainer, handlers: OverlayHandlers) {
    this.handlers = handlers

    this.overlayEl = shadow.el<HTMLDivElement>('div', 'mtb-overlay')

    this.onPointerDown = (e) => {
      const pe = e as PointerEvent
      if (!pe.isPrimary) return
      // Capture keeps a stroke alive when the finger crosses the overlay edge.
      // Without it, a drag that leaves the surface silently stops mid-line.
      try {
        this.overlayEl.setPointerCapture(pe.pointerId)
      } catch {
        // Thrown when the pointer is already gone. The stroke can still run
        // uncaptured, so this is not worth aborting the gesture over.
      }
      this.handlers.onPointerDown(pe)
    }

    this.onPointerMove = (e) => {
      const pe = e as PointerEvent
      if (!pe.isPrimary) return
      this.handlers.onPointerMove(pe)
    }

    this.onPointerUp = (e) => {
      const pe = e as PointerEvent
      if (!pe.isPrimary) return
      this.releaseCapture(pe.pointerId)
      this.handlers.onPointerUp(pe)
    }

    // Replaces the old mouseleave path. The browser fires this when it takes
    // the gesture away from us — a system gesture, or the page going
    // background — which is exactly when a half-drawn stroke should end.
    this.onPointerCancel = (e) => {
      const pe = e as PointerEvent
      // A palm or second finger can be cancelled on its own. That pointer never
      // reached the handlers, so acting on its cancel would cut short a stroke
      // the primary finger is still drawing.
      if (!pe.isPrimary) return
      this.releaseCapture(pe.pointerId)
      this.handlers.onPointerCancel(pe)
    }

    this.overlayEl.addEventListener('pointerdown', this.onPointerDown)
    this.overlayEl.addEventListener('pointermove', this.onPointerMove)
    this.overlayEl.addEventListener('pointerup', this.onPointerUp)
    this.overlayEl.addEventListener('pointercancel', this.onPointerCancel)
    shadow.append(this.overlayEl)

    this.dimEl = shadow.el<HTMLDivElement>('div', 'mtb-dim')
    shadow.append(this.dimEl)
  }

  private releaseCapture(pointerId: number): void {
    try {
      this.overlayEl.releasePointerCapture(pointerId)
    } catch {
      // Already released, or the pointer is gone. Nothing to undo.
    }
  }

  destroy(): void {
    this.overlayEl.removeEventListener('pointerdown', this.onPointerDown)
    this.overlayEl.removeEventListener('pointermove', this.onPointerMove)
    this.overlayEl.removeEventListener('pointerup', this.onPointerUp)
    this.overlayEl.removeEventListener('pointercancel', this.onPointerCancel)
    this.overlayEl.remove()
    this.dimEl.remove()
  }
}
