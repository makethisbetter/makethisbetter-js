import { afterEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from './shadow'
import { DimOverlay } from './dim-overlay'

describe('DimOverlay', () => {
  let shadow: ShadowContainer

  afterEach(() => {
    shadow.destroy()
    document.body.innerHTML = ''
  })

  // A fake clock rather than fake timers: the scrim compares timestamps, and
  // the behaviour under test is "how long after birth", not "after a timeout".
  function clockFrom(start: number) {
    let t = start
    return { now: () => t, advance: (ms: number) => { t += ms } }
  }

  it('renders a clickable dim scrim that invokes the reset callback on click', () => {
    shadow = new ShadowContainer()
    const onClick = vi.fn()
    const clock = clockFrom(1_000)
    const dim = new DimOverlay(shadow, onClick, clock.now)

    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-dim.mtb-dim-clickable')!
    expect(el).toBeTruthy()

    clock.advance(1_000)
    el.click()
    expect(onClick).toHaveBeenCalledOnce()

    dim.destroy()
    expect(shadow.root.querySelector('.mtb-dim-clickable')).toBeNull()
  })

  // Observed on iOS 18.7: the tap that opens the popup is replayed as a
  // compatibility click once this scrim already exists, so the gesture that
  // opened the sheet immediately dismissed it again.
  it('ignores the compatibility click replayed from the tap that created it', () => {
    shadow = new ShadowContainer()
    const onClick = vi.fn()
    const clock = clockFrom(1_000)
    const dim = new DimOverlay(shadow, onClick, clock.now)

    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-dim-clickable')!
    clock.advance(80)
    el.click()

    expect(onClick).not.toHaveBeenCalled()
    dim.destroy()
  })

  it('accepts a dismissal once the gesture can only be a new one', () => {
    shadow = new ShadowContainer()
    const onClick = vi.fn()
    const clock = clockFrom(1_000)
    const dim = new DimOverlay(shadow, onClick, clock.now)

    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-dim-clickable')!
    clock.advance(400)
    el.click()

    expect(onClick).toHaveBeenCalledOnce()
    dim.destroy()
  })
})
