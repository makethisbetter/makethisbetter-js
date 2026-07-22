import { afterEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from './shadow'
import { DimOverlay } from './dim-overlay'

describe('DimOverlay', () => {
  let shadow: ShadowContainer

  afterEach(() => {
    shadow.destroy()
    document.body.innerHTML = ''
  })

  it('renders a clickable dim scrim that invokes the reset callback on click', () => {
    shadow = new ShadowContainer()
    const onClick = vi.fn()
    const dim = new DimOverlay(shadow, onClick)

    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-dim.mtb-dim-clickable')!
    expect(el).toBeTruthy()

    el.click()
    expect(onClick).toHaveBeenCalledOnce()

    dim.destroy()
    expect(shadow.root.querySelector('.mtb-dim-clickable')).toBeNull()
  })
})
