import { describe, expect, it } from 'vitest'
import cssText from './widget.css?inline'

function rule(selector: string, start = 0): string {
  const ruleStart = cssText.indexOf(`${selector} {`, start)
  expect(ruleStart, `the stylesheet should define ${selector}`).toBeGreaterThan(-1)
  return cssText.slice(ruleStart, cssText.indexOf('}', ruleStart))
}

describe('clarification card size', () => {
  it('keeps the desktop conversation roomy', () => {
    expect(rule('.mtb-clarify')).toContain('min-height: min(270px, calc(100vh - 24px))')
  })

  it('keeps the narrow-screen sheet within its viewport cap', () => {
    const mobile = cssText.indexOf('@media (max-width: 480px)')
    expect(mobile, 'the mobile block should exist').toBeGreaterThan(-1)
    expect(rule('.mtb-clarify', mobile)).toContain('min-height: min(270px, 85vh)')
  })
})
