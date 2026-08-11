/**
 * Keeps keyboard focus inside an open card, and remembers who opened it.
 *
 * The cards float above a dimmed host page, but the dim is only visual: Tab
 * happily walks out of the card and into controls the reporter can no longer
 * see or reach with a pointer. Cycling within the card is what the dialog role
 * promises assistive tech, and restoring the opener afterwards puts a keyboard
 * user back where they were instead of at the top of the document.
 *
 * The Tab handler lives on the card element, not on document or window: it can
 * only ever see keys typed while focus is inside the card, and removing the
 * card's own listener is a teardown the host page cannot be stranded by.
 */
export interface FocusTrap {
  /**
   * Detach the Tab handler without moving focus — for when the element is
   * handed to a successor (the clarify continuation) that installs its own
   * trap and must not have focus yanked out from under it.
   */
  release(): void
  /** Put focus back on whatever had it when the trap was installed. */
  restoreFocus(): void
}

const TABBABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function trapFocus(card: HTMLElement): FocusTrap {
  // Captured before any card control gets autofocused, so the trap remembers
  // the host page's element, not the card's own field.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const tabbables = Array.from(card.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR))
      .filter(el => !el.hidden)
    if (tabbables.length === 0) return

    const first = tabbables[0]
    const last = tabbables[tabbables.length - 1]
    // Inside a shadow tree the document only reports the host element; the
    // shadow root knows which control actually holds focus. Fall back to the
    // document for environments that leave ShadowRoot.activeElement null.
    const root = card.getRootNode() as Document | ShadowRoot
    const active = root.activeElement ?? document.activeElement

    if (event.shiftKey) {
      if (active === first || !card.contains(active)) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      }
    } else if (active === last || !card.contains(active)) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  card.addEventListener('keydown', handleKeydown)

  return {
    release(): void {
      card.removeEventListener('keydown', handleKeydown)
    },
    restoreFocus(): void {
      // A detached opener would silently drop focus on <body>, so only reach
      // for one that still exists. preventScroll for the same reason every
      // panel uses it: the widget must never scroll the host page.
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    },
  }
}
