import { describe, expect, it } from 'vitest'
import cssText from './widget.css?inline'

function rule(selector: string): string {
  const ruleStart = cssText.indexOf(`${selector} {`)
  expect(ruleStart, `the stylesheet should define ${selector}`).toBeGreaterThan(-1)
  return cssText.slice(ruleStart, cssText.indexOf('}', ruleStart))
}

describe('success card theme', () => {
  it('keeps the email prompt as subdued as the success message', () => {
    expect(rule('.mtb-email-prompt')).toContain('color: var(--mtb-success-msg-fg)')
  })

  it('uses the success card font for the view feedback action', () => {
    expect(rule('.mtb-view-feedback-link')).toContain('font-family: inherit')
  })
})
