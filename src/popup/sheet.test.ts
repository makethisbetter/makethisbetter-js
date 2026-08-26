import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { SheetLayout, isSheetViewport } from './sheet'

interface FakeViewport {
  height: number
  offsetTop: number
  fire: (type: string) => void
}

function install(width: number, height = 852, vpHeight = height): FakeViewport {
  const listeners: Record<string, Array<() => void>> = {}
  const vp = {
    height: vpHeight,
    offsetTop: 0,
    addEventListener: (t: string, fn: () => void) => { (listeners[t] ??= []).push(fn) },
    removeEventListener: (t: string, fn: () => void) => {
      listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn)
    },
    fire: (t: string) => { for (const fn of listeners[t] ?? []) fn() },
  }
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
  Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true, writable: true })
  return vp as unknown as FakeViewport
}

function panel(): HTMLElement {
  const el = document.createElement('div')
  el.style.left = '120px'
  el.style.top = '300px'
  el.style.maxHeight = '400px'
  document.body.appendChild(el)
  return el
}

describe('SheetLayout', () => {
  beforeEach(() => { vi.useFakeTimers() })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })
  })

  it('reports narrow viewports as sheet territory', () => {
    install(393)
    expect(isSheetViewport()).toBe(true)
    install(481)
    expect(isSheetViewport()).toBe(false)
  })

  it('declines to take over on a wide viewport, leaving the caller to position', () => {
    install(1024)
    const el = panel()
    const sheet = new SheetLayout(el)

    expect(sheet.apply()).toBe(false)
    expect(el.style.left).toBe('120px')
  })

  // Inline coordinates outrank a media query, so overriding is not enough —
  // they have to be cleared or the sheet snaps back to a floating card.
  it('clears inline geometry so the stylesheet can own the layout', () => {
    install(393)
    const el = panel()
    const sheet = new SheetLayout(el)

    expect(sheet.apply()).toBe(true)
    expect(el.style.left).toBe('')
    expect(el.style.top).toBe('')
    expect(el.style.maxHeight).toBe('')

    sheet.release()
  })

  it('lifts the panel by the keyboard height and puts it back', () => {
    const vp = install(393, 852)
    const el = panel()
    const sheet = new SheetLayout(el)
    sheet.apply()

    expect(el.style.bottom).toBe('')

    vp.height = 561
    vp.fire('resize')
    vi.advanceTimersByTime(300)
    expect(el.style.bottom).toBe('291px')

    vp.height = 852
    vp.fire('resize')
    vi.advanceTimersByTime(300)
    expect(el.style.bottom).toBe('')

    sheet.release()
  })

  it('stops tracking after release', () => {
    const vp = install(393, 852)
    const el = panel()
    const sheet = new SheetLayout(el)
    sheet.apply()
    sheet.release()

    vp.height = 561
    vp.fire('resize')
    vi.advanceTimersByTime(500)
    expect(el.style.bottom).toBe('')
  })

  // Never trades one unusable state for another: a reading that would push the
  // panel past the top of the window is applied only as far as it can go.
  it('lifts no further than keeps the panel on screen', () => {
    const vp = install(393, 852, 200)
    const el = panel()
    Object.defineProperty(el, 'offsetHeight', { value: 500, configurable: true })

    const sheet = new SheetLayout(el)
    sheet.apply()

    // Inset would be 652; anything past 352 would take the panel off the top.
    expect(el.style.bottom).toBe('352px')
    void vp
    sheet.release()
  })

  it('picks up a keyboard that is already open when it applies', () => {
    install(393, 852, 561)
    const el = panel()
    const sheet = new SheetLayout(el)
    sheet.apply()

    expect(el.style.bottom).toBe('291px')
    sheet.release()
  })
})
