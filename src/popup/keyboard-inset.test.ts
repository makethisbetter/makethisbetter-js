import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { KeyboardInset } from './keyboard-inset'

interface FakeViewport {
  height: number
  offsetTop: number
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
  fire: (type: string) => void
}

function fakeViewport(height: number, offsetTop = 0): FakeViewport {
  const listeners: Record<string, Array<() => void>> = {}
  return {
    height,
    offsetTop,
    addEventListener(type, fn) {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
    },
    fire(type) {
      for (const fn of listeners[type] ?? []) fn()
    },
  }
}

function install(vp: FakeViewport | undefined, innerHeight = 852) {
  Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true, writable: true })
}

describe('KeyboardInset', () => {
  beforeEach(() => { vi.useFakeTimers() })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })
  })

  it('reports no inset when the viewport fills the window', () => {
    install(fakeViewport(852))
    const inset = new KeyboardInset()
    expect(inset.current()).toBe(0)
  })

  it('reports the covered height when the keyboard is open', () => {
    install(fakeViewport(561))
    const inset = new KeyboardInset()
    expect(inset.current()).toBe(291)
  })

  // iOS does not only shrink the visual viewport, it also shifts it up. Only
  // subtracting height leaves the sheet offset by exactly offsetTop, which
  // shows as a strip of page wedged between the sheet and the keyboard.
  it('accounts for the viewport being shifted up, not just shrunk', () => {
    install(fakeViewport(561, 40))
    const inset = new KeyboardInset()
    expect(inset.current()).toBe(251)
  })

  // Android resizes the layout viewport itself, so innerHeight shrinks with
  // the keyboard and there is nothing left to compensate for.
  it('reports no inset when the layout viewport shrank with the keyboard', () => {
    install(fakeViewport(561), 561)
    const inset = new KeyboardInset()
    expect(inset.current()).toBe(0)
  })

  it('never reports a negative inset', () => {
    install(fakeViewport(900))
    const inset = new KeyboardInset()
    expect(inset.current()).toBe(0)
  })

  it('notifies on resize and on scroll', () => {
    const vp = fakeViewport(852)
    install(vp)
    const onChange = vi.fn()

    const inset = new KeyboardInset()
    inset.observe(onChange)

    vp.height = 561
    vp.fire('resize')
    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenLastCalledWith(291)

    vp.offsetTop = 40
    vp.fire('scroll')
    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenLastCalledWith(251)

    inset.stop()
  })

  it('stops notifying after stop()', () => {
    const vp = fakeViewport(852)
    install(vp)
    const onChange = vi.fn()

    const inset = new KeyboardInset()
    inset.observe(onChange)
    inset.stop()

    vp.height = 561
    vp.fire('resize')
    vi.advanceTimersByTime(500)
    expect(onChange).not.toHaveBeenCalled()
  })

  // Measured on iOS 18.7: the viewport reported 660 -> 323 -> 95 -> 660 over
  // 130ms as the keyboard slid in. Acting on each frame walked the sheet off
  // the top of the screen and back.
  it('reports once, after the viewport stops moving', () => {
    const vp = fakeViewport(852)
    install(vp)
    const onChange = vi.fn()

    const inset = new KeyboardInset()
    inset.observe(onChange)

    vp.height = 400; vp.fire('resize')
    vi.advanceTimersByTime(30)
    vp.height = 120; vp.fire('resize')
    vi.advanceTimersByTime(30)
    vp.height = 561; vp.fire('resize')

    expect(onChange).not.toHaveBeenCalled()
    // One quiet interval only proves events paused; the value has to repeat.
    vi.advanceTimersByTime(140)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(140)
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(291)

    inset.stop()
  })

  // Keeping the panel on screen is SheetLayout's job — it is the one that
  // knows how tall the panel is. See sheet.test.ts. What belongs here is
  // whether a reading is a measurement at all.

  // Seen on an iOS 18.7 device while the keyboard was animating in.
  it('discards a negative viewport height rather than deriving an inset', () => {
    install(fakeViewport(-122))
    expect(new KeyboardInset().current()).toBe(0)
  })

  it('never reports more inset than the window holds', () => {
    install(fakeViewport(10, -900))
    expect(new KeyboardInset().current()).toBeLessThanOrEqual(852)
  })

  it('degrades to a fixed zero inset where visualViewport is unavailable', () => {
    install(undefined)
    const onChange = vi.fn()

    const inset = new KeyboardInset()
    expect(inset.current()).toBe(0)
    expect(() => {
      inset.observe(onChange)
      inset.stop()
    }).not.toThrow()
  })
})
