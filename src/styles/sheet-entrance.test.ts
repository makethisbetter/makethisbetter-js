import { describe, it, expect } from 'vitest'
import cssText from './widget.css?inline'

/**
 * The mobile sheet appears in place, with no entrance animation.
 *
 * Two separate "the panel flickers" reports from a phone came from animating
 * it: the keyboard offset landing mid-slide, and then a spring curve — the one
 * the desktop popup uses — overshooting its target by 9.8%. That is 1.4px of
 * pleasant bounce on a 14px card and 37px on a panel that travels its own full
 * height, which showed a strip of page under the sheet and snapped it back.
 *
 * A panel covering most of the screen cannot move a little. Since the motion
 * was not telling the reporter anything, it is gone rather than tuned.
 */
describe('mobile panel entrance', () => {
  function mobileRule(selector: string): string {
    const block = cssText.indexOf('@media (max-width: 480px)')
    expect(block, 'the mobile block should exist').toBeGreaterThan(-1)
    const rule = cssText.indexOf(`${selector} {`, block)
    expect(rule, `the mobile block should restyle ${selector}`).toBeGreaterThan(-1)
    return cssText.slice(rule, cssText.indexOf('}', rule))
  }

  for (const selector of ['.mtb-chat', '.mtb-toolbar']) {
    it(`${selector} appears without animating`, () => {
      expect(mobileRule(selector)).toContain('animation: none')
    })
  }

  // Tuning an easing was the previous answer and it cost a round of testing on
  // a real phone. Anything reintroducing motion here should fail first.
  it('declares no easing curve for the sheet', () => {
    expect(mobileRule('.mtb-chat')).not.toMatch(/cubic-bezier/)
  })
})
