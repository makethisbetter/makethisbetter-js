import { describe, expect, it } from 'vitest'
import cssText from './widget.css?inline'

function rule(selector: string, start = 0): string {
  const ruleStart = cssText.indexOf(`${selector} {`, start)
  expect(ruleStart, `the stylesheet should define ${selector}`).toBeGreaterThan(-1)
  return cssText.slice(ruleStart, cssText.indexOf('}', ruleStart))
}

describe('theme placeholder color', () => {
  it('uses a light foreground in explicit and automatic dark themes', () => {
    const themeTokens = cssText.indexOf('Theme tokens')
    expect(rule(':host', themeTokens)).toContain('--mtb-placeholder-fg: rgba(0, 0, 0, 0.34)')
    expect(rule(':host([data-mtb-theme="dark"])')).toContain(
      '--mtb-placeholder-fg: rgba(255, 255, 255, 0.4)',
    )

    const darkPreference = cssText.indexOf('@media (prefers-color-scheme: dark)')
    expect(rule(':host([data-mtb-theme="auto"])', darkPreference)).toContain(
      '--mtb-placeholder-fg: rgba(255, 255, 255, 0.4)',
    )
  })

  // The chat card has its own placeholder token, themed alongside the shared
  // one; the draw bar is always-light and keeps a literal grey on purpose.
  it.each(['.mtb-chat-input::placeholder', '.mtb-chat-email-input::placeholder'])(
    'themes %s through the chat token',
    (selector) => {
      expect(rule(selector)).toContain('color: var(--mtb-chat-placeholder-fg)')
    },
  )
})
