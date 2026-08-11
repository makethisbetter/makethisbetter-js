import type { ShadowContainer } from './shadow'

/**
 * A touch browser replays the tap that opened the popup as a compatibility
 * click a moment after pointerup — and by then this scrim exists underneath,
 * so that click dismissed the popup the same gesture had just opened. On a
 * phone it read as the sheet flashing and vanishing, or as tapping doing
 * nothing at all. Cancelling pointerdown does not prevent it: WebKit still
 * dispatches the click (observed on iOS 18.7).
 *
 * So the scrim ignores anything that arrives before it could plausibly be a
 * new gesture. A deliberate dismissal is a separate press, well past this.
 */
const SPAWN_CLICK_GRACE_MS = 400

// Full-screen scrim shown behind the comment popup. Clicking it resets the
// widget, mirroring the design's dim-to-dismiss behaviour.
export class DimOverlay {
  private el: HTMLDivElement
  private bornAt = Date.now()
  private onClick: (e: Event) => void

  constructor(shadow: ShadowContainer, onDismiss: () => void, now: () => number = () => Date.now()) {
    this.bornAt = now()
    this.onClick = () => {
      if (now() - this.bornAt < SPAWN_CLICK_GRACE_MS) return
      onDismiss()
    }
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-dim mtb-dim-clickable')
    this.el.addEventListener('click', this.onClick)
    shadow.append(this.el)
  }

  destroy(): void {
    this.el.removeEventListener('click', this.onClick)
    this.el.remove()
  }
}
