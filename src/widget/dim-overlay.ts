import type { ShadowContainer } from './shadow'

// Full-screen scrim shown behind the comment popup. Clicking it resets the
// widget, mirroring the design's dim-to-dismiss behaviour.
export class DimOverlay {
  private el: HTMLDivElement
  private onClick: () => void

  constructor(shadow: ShadowContainer, onClick: () => void) {
    this.onClick = onClick
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-dim mtb-dim-clickable')
    this.el.addEventListener('click', this.onClick)
    shadow.append(this.el)
  }

  destroy(): void {
    this.el.removeEventListener('click', this.onClick)
    this.el.remove()
  }
}
