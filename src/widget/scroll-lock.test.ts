import { afterEach, describe, expect, it } from 'vitest'
import { lockPageScroll } from './scroll-lock'
import type { ScrollLock } from './scroll-lock'

let lock: ScrollLock | null = null

function engage(): void {
  lock = lockPageScroll()
}

function wheelOver(target: EventTarget): boolean {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/** jsdom lays nothing out, so a scrollable box has to say so itself. */
function makeScrollable(el: HTMLElement): HTMLElement {
  el.style.overflowY = 'auto'
  Object.defineProperty(el, 'scrollHeight', { value: 400, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
  return el
}

afterEach(() => {
  lock?.release()
  lock = null
  document.body.innerHTML = ''
})

describe('lockPageScroll', () => {
  it('cancels a wheel gesture aimed at the page', () => {
    engage()

    expect(wheelOver(document.body)).toBe(true)
  })

  it('lets the page scroll again once released', () => {
    engage()
    lock!.release()
    lock = null

    expect(wheelOver(document.body)).toBe(false)
  })

  // Releasing twice happens on the ordinary path: the note surface tears down
  // and then the abandon route runs its own release over the top.
  it('survives a second release', () => {
    engage()
    lock!.release()

    expect(() => lock!.release()).not.toThrow()
  })

  // The note field grows past its box on a long report, and the follow-up
  // transcript scrolls by design. Holding the page must not hold those.
  it('leaves a scrollable element under the pointer alone', () => {
    const box = makeScrollable(document.createElement('div'))
    const field = document.createElement('textarea')
    box.appendChild(field)
    document.body.appendChild(box)
    engage()

    expect(wheelOver(field)).toBe(false)
  })

  // Same markup, nothing overflowing: the gesture would fall through to the
  // page, which is exactly what is being held.
  it('cancels over an element with room to spare', () => {
    const box = document.createElement('div')
    box.style.overflowY = 'auto'
    document.body.appendChild(box)
    engage()

    expect(wheelOver(box)).toBe(true)
  })

  it('cancels scroll-triggering keystrokes', () => {
    engage()

    for (const key of ['ArrowDown', 'PageDown', 'Home', 'End', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it('lets non-scroll keys through', () => {
    engage()

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('lets all scroll keys through on text-input elements', () => {
    engage()

    for (const tag of ['textarea', 'input', 'select'] as const) {
      const el = document.createElement(tag)
      document.body.appendChild(el)
      for (const key of ['ArrowDown', 'PageDown', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        el.dispatchEvent(event)
        expect(event.defaultPrevented, `${key} should pass through on ${tag}`).toBe(false)
      }
    }
  })

  it('lets Space through on button and summary but blocks other scroll keys', () => {
    engage()

    for (const tag of ['button', 'summary'] as const) {
      const el = document.createElement(tag)
      document.body.appendChild(el)

      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      el.dispatchEvent(space)
      expect(space.defaultPrevented, `Space should pass through on ${tag}`).toBe(false)

      const pgdn = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
      el.dispatchEvent(pgdn)
      expect(pgdn.defaultPrevented, `PageDown should be blocked on ${tag}`).toBe(true)
    }
  })

  it('blocks Space on links since they activate via Enter', () => {
    engage()
    const a = document.createElement('a')
    a.href = '#'
    document.body.appendChild(a)

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    a.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('blocks scroll keys on tabindex and ARIA-role elements', () => {
    engage()

    const cases: [string, () => HTMLElement][] = [
      ['[tabindex]', () => { const d = document.createElement('div'); d.tabIndex = 0; return d }],
      ['[role=button]', () => { const d = document.createElement('div'); d.setAttribute('role', 'button'); return d }],
    ]

    for (const [label, make] of cases) {
      const el = make()
      document.body.appendChild(el)
      const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      expect(event.defaultPrevented, `PageDown should be blocked on ${label}`).toBe(true)
    }
  })

  it('releases keyboard listener on release', () => {
    engage()
    lock!.release()
    lock = null

    const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  // The host page keeps its own styles: nothing here is restored on release,
  // so nothing can be left behind if a teardown is ever missed.
  it('writes nothing onto the host page', () => {
    document.body.style.overflow = 'auto'
    engage()

    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.position).toBe('')
  })
})
