import type { ShadowContainer } from '../widget/shadow'
import { getElementName } from '../context/dom-utils'

export class ElementHighlighter {
  private highlightEl: HTMLDivElement
  private tooltipEl: HTMLDivElement

  constructor(shadow: ShadowContainer) {
    this.highlightEl = shadow.el<HTMLDivElement>('div', 'mtb-highlight')
    this.tooltipEl = shadow.el<HTMLDivElement>('div', 'mtb-highlight-tooltip')
    this.hide()
    shadow.append(this.highlightEl, this.tooltipEl)
  }

  highlight(el: Element): void {
    const rect = el.getBoundingClientRect()
    this.highlightEl.style.top = `${rect.top - 2}px`
    this.highlightEl.style.left = `${rect.left - 2}px`
    this.highlightEl.style.width = `${rect.width + 4}px`
    this.highlightEl.style.height = `${rect.height + 4}px`
    this.highlightEl.style.display = 'block'
    this.showTooltip(el, rect)
  }

  private showTooltip(el: Element, rect: DOMRect): void {
    this.tooltipEl.textContent = getElementName(el)
    const below = rect.top < 30
    this.tooltipEl.classList.toggle('below', below)
    this.tooltipEl.style.left = `${rect.left + rect.width / 2}px`
    this.tooltipEl.style.top = below ? `${rect.bottom + 8}px` : `${rect.top - 8}px`
    this.tooltipEl.style.display = 'block'
  }

  select(): void {
    this.highlightEl.classList.add('selected')
    this.tooltipEl.style.display = 'none'
  }

  hide(): void {
    this.highlightEl.style.display = 'none'
    this.highlightEl.classList.remove('selected')
    this.tooltipEl.style.display = 'none'
  }

  destroy(): void {
    this.highlightEl.remove()
    this.tooltipEl.remove()
  }
}
