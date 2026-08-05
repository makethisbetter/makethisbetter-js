import { describe, it, expect } from 'vitest'
import cssText from './widget.css?inline'

// iOS zooms the whole page when a focused field computes under 16px, and it
// never zooms back — the reporter is left on a magnified page and reads it as
// the widget breaking the site. 16px is the platform threshold, not taste, so
// it is asserted rather than left to whoever next tunes the type scale.
describe('touch input font size', () => {
  const INPUTS = ['.mtb-textarea', '.mtb-clarify-input', '.mtb-draw-input', '.mtb-email-input']

  function coarseBlock(): string {
    const start = cssText.indexOf('@media (pointer: coarse)')
    expect(start, 'the (pointer: coarse) block should exist').toBeGreaterThan(-1)

    let depth = 0
    for (let i = cssText.indexOf('{', start); i < cssText.length; i++) {
      if (cssText[i] === '{') depth++
      else if (cssText[i] === '}' && --depth === 0) return cssText.slice(start, i + 1)
    }
    throw new Error('unbalanced braces in the (pointer: coarse) block')
  }

  it('lifts every text field to 16px on touch devices', () => {
    const block = coarseBlock()
    for (const sel of INPUTS) {
      expect(block, `${sel} must be raised to 16px for touch`).toContain(sel)
    }
    expect(block).toMatch(/font-size:\s*16px/)
  })

  // Reads the templates rather than trusting the list above, so a field added
  // later fails here instead of on someone's phone.
  it('covers every input and textarea the widget renders', () => {
    const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true })
    const found = new Set<string>()

    for (const [path, source] of Object.entries(sources)) {
      if (path.includes('.test.')) continue
      const tags = String(source).matchAll(/<(?:input|textarea)\b[^>]*class="([^"]+)"/g)
      for (const [, classes] of tags) {
        for (const cls of classes.split(/\s+/)) found.add(`.${cls}`)
      }
    }

    expect([...found].sort()).toEqual([...INPUTS].sort())
  })
})
