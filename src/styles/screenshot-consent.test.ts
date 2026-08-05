import { describe, expect, it } from 'vitest'
import cssText from './widget.css?inline'

describe('locked screenshot consent', () => {
  // The tick is drawn by us (native disabled paint can wash it out entirely),
  // but in the disabled grey, not the brand colour: a full-brand tick reads as
  // a control that takes clicks, and this one deliberately doesn't.
  it('paints the locked tick grey with the tick still visible', () => {
    const locked = cssText.indexOf('.mtb-screenshot-opt--locked input:disabled')
    expect(locked, 'the locked disabled rule should exist').toBeGreaterThan(-1)
    const rule = cssText.slice(locked, cssText.indexOf('}', locked))
    expect(rule).toContain('appearance: none')
    expect(rule).toContain('background-color: var(--mtb-placeholder-fg)')
    expect(rule).not.toContain('var(--mtb-brand-primary)')
    expect(rule).toContain('data:image/svg+xml')
  })

  it('gives the always-light draw bar its own literal grey', () => {
    const idx = cssText.lastIndexOf('.mtb-draw-shot input:disabled')
    expect(idx).toBeGreaterThan(-1)
    const rule = cssText.slice(idx, cssText.indexOf('}', idx))
    expect(rule).toContain('background-color: rgba(0, 0, 0, 0.3)')
  })
})
