/**
 * Holds the host page still for the entire annotation flow.
 *
 * Strokes, pins, highlights, and note cards are all positioned in viewport
 * coordinates. Scrolling while any of them are visible moves the page out from
 * under them, stranding annotations beside unrelated content. The lock engages
 * when the annotation chrome mounts and releases when the flow ends (exitAll)
 * or when the submission tears down the anchored surfaces.
 *
 * Nothing on the host page is mutated to achieve this. `overflow: hidden` on the
 * body is the usual reflex and it cost this widget three defects before (it is
 * inert on iOS, loses the scroll position when moved to the document element,
 * and jumps the page when the body leaves flow). Cancelling the gestures that
 * scroll leaves the page's own styles untouched, so there is nothing to restore
 * and nothing to strand if teardown is ever missed.
 */
export interface ScrollLock {
  /** Let the page scroll again. Safe to call more than once. */
  release(): void
}

const POINTER_GESTURES = ['wheel', 'touchmove'] as const

const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End', ' ',
])

function scrollsInternally(event: Event): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue
    const style = getComputedStyle(node)
    const scrollable = /auto|scroll/.test(`${style.overflowY} ${style.overflowX}`)
    if (!scrollable) continue
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) return true
  }
  return false
}

function consumesScrollKey(el: Element, key: string): boolean {
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  if (key === ' ' && (tag === 'BUTTON' || tag === 'SUMMARY')) return true
  return false
}

export function lockPageScroll(): ScrollLock {
  const blockGesture = (event: Event): void => {
    if (scrollsInternally(event)) return
    if (event.cancelable) event.preventDefault()
  }

  const blockKey = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return
    if (!SCROLL_KEYS.has(event.key)) return
    const origin = event.composedPath()[0]
    if (origin instanceof Element && consumesScrollKey(origin, event.key)) return
    if (event.cancelable) event.preventDefault()
  }

  for (const gesture of POINTER_GESTURES) {
    window.addEventListener(gesture, blockGesture, { capture: true, passive: false })
  }
  window.addEventListener('keydown', blockKey, { capture: true })

  return {
    release(): void {
      for (const gesture of POINTER_GESTURES) {
        window.removeEventListener(gesture, blockGesture, { capture: true })
      }
      window.removeEventListener('keydown', blockKey, { capture: true })
    },
  }
}
