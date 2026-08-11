import { describe, expect, it } from 'vitest'
import cssText from './widget.css?inline'

// Every default-green literal that may legally appear in the stylesheet lives
// inside a :host token block; components must read the tokens. A literal
// anywhere else is a colour that will ignore a customer's brandColors — the
// success-card icon, its tinted circle and the email-saved text all shipped
// that way before this guard existed.
const DEFAULT_GREEN_LITERALS = [
  '#059669',
  '#10b981',
  '#047857',
  '#065f46',
  '5, 150, 105',
  '16, 185, 129',
]

// A :host block is `:host { ... }` or `:host([...]) { ... }` — single-level,
// no nesting in this stylesheet.
function withoutHostTokenBlocks(css: string): string {
  return css.replace(/:host[^{]*\{[^}]*\}/g, '')
}

describe('brand colour guard', () => {
  it('keeps every default-green literal inside the :host token blocks', () => {
    const body = withoutHostTokenBlocks(cssText)
    for (const literal of DEFAULT_GREEN_LITERALS) {
      const at = body.indexOf(literal)
      expect(
        at,
        `"${literal}" appears outside the :host token blocks near: …${body.slice(Math.max(0, at - 80), at + 40)}…`,
      ).toBe(-1)
    }
  })

  // The removal itself has to be sane: if the regex ever stops matching, the
  // first assertion would pass vacuously against an unstripped sheet only when
  // the sheet has no literals at all — this pins that the strip really ran.
  it('actually strips the token blocks it exempts', () => {
    expect(cssText).toContain('--mtb-brand-primary: #059669')
    expect(withoutHostTokenBlocks(cssText)).not.toContain('--mtb-brand-primary: #059669')
  })
})
