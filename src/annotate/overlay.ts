import type { ShadowContainer } from '../widget/shadow'

export class AnnotationOverlay {
  private overlayEl: HTMLDivElement
  private dimEl: HTMLDivElement
  private onMouseDown: (e: MouseEvent) => void
  private onMouseMove: (e: MouseEvent) => void
  private onMouseUp: (e: MouseEvent) => void
  private onMouseLeave: (e: MouseEvent) => void

  constructor(
    shadow: ShadowContainer,
    handlers: {
      onMouseDown: (e: MouseEvent) => void
      onMouseMove: (e: MouseEvent) => void
      onMouseUp: (e: MouseEvent) => void
      onMouseLeave: (e: MouseEvent) => void
    },
  ) {
    this.onMouseDown = handlers.onMouseDown
    this.onMouseMove = handlers.onMouseMove
    this.onMouseUp = handlers.onMouseUp
    this.onMouseLeave = handlers.onMouseLeave

    this.overlayEl = shadow.el<HTMLDivElement>('div', 'mtb-overlay')
    this.overlayEl.addEventListener('mousedown', this.onMouseDown)
    this.overlayEl.addEventListener('mousemove', this.onMouseMove)
    this.overlayEl.addEventListener('mouseup', this.onMouseUp)
    this.overlayEl.addEventListener('mouseleave', this.onMouseLeave)
    shadow.append(this.overlayEl)

    this.dimEl = shadow.el<HTMLDivElement>('div', 'mtb-dim')
    shadow.append(this.dimEl)
  }

  destroy(): void {
    this.overlayEl.removeEventListener('mousedown', this.onMouseDown)
    this.overlayEl.removeEventListener('mousemove', this.onMouseMove)
    this.overlayEl.removeEventListener('mouseup', this.onMouseUp)
    this.overlayEl.removeEventListener('mouseleave', this.onMouseLeave)
    this.overlayEl.remove()
    this.dimEl.remove()
  }
}
