import { describe, it, expect } from 'vitest'
import { getElementName, getCssSelector } from './highlighter'

describe('getElementName', () => {
  it('returns aria-label when present', () => {
    const el = document.createElement('button')
    el.setAttribute('aria-label', 'Close dialog')
    expect(getElementName(el)).toBe('Close dialog')
  })

  it('returns text content when no label', () => {
    const el = document.createElement('button')
    el.textContent = 'Export PDF'
    expect(getElementName(el)).toBe('Export PDF')
  })

  it('returns tag name as fallback', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    expect(getElementName(el)).toBe('svg')
  })

  it('truncates long text content', () => {
    const el = document.createElement('p')
    el.textContent = 'a'.repeat(100)
    expect(getElementName(el).length).toBeLessThanOrEqual(40)
  })
})

describe('getCssSelector', () => {
  it('returns id selector when element has id', () => {
    const el = document.createElement('div')
    el.id = 'main'
    document.body.appendChild(el)
    expect(getCssSelector(el)).toBe('#main')
    document.body.removeChild(el)
  })

  it('returns tag selector for unknown element', () => {
    const el = document.createElement('span')
    const parent = document.createElement('div')
    parent.appendChild(el)
    document.body.appendChild(parent)
    const selector = getCssSelector(el)
    expect(selector).toContain('span')
    document.body.removeChild(parent)
  })
})
