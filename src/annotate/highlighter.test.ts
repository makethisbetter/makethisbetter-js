import { describe, it, expect } from 'vitest'
import { ElementHighlighter } from './highlighter'
import { ShadowContainer } from '../widget/shadow'

describe('ElementHighlighter tooltip', () => {
  it('shows a tooltip with the element name on highlight', () => {
    const shadow = new ShadowContainer()
    const highlighter = new ElementHighlighter(shadow)
    const el = document.createElement('button')
    el.textContent = 'Export PDF'
    document.body.appendChild(el)

    highlighter.highlight(el)
    const tooltip = shadow.root.querySelector<HTMLDivElement>('.mtb-highlight-tooltip')!
    expect(tooltip.textContent).toBe('Export PDF')
    expect(tooltip.style.display).toBe('block')

    highlighter.hide()
    expect(tooltip.style.display).toBe('none')

    highlighter.destroy()
    document.body.removeChild(el)
    shadow.destroy()
  })
})
