import type { ShadowContainer } from '../widget/shadow'

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

  hide(): void {
    this.highlightEl.style.display = 'none'
    this.tooltipEl.style.display = 'none'
  }

  destroy(): void {
    this.highlightEl.remove()
    this.tooltipEl.remove()
  }
}

export function getElementName(el: Element): string {
  if (el instanceof HTMLElement) {
    const label = el.getAttribute('aria-label')
    if (label) return label

    const title = el.getAttribute('title')
    if (title) return title

    const text = el.textContent?.trim().slice(0, 40)
    if (text) return text

    const placeholder = (el as HTMLInputElement).placeholder
    if (placeholder) return placeholder

    const alt = (el as HTMLImageElement).alt
    if (alt) return alt

    const dataMark = el.getAttribute('data-mark')
    if (dataMark) return dataMark
  }
  return el.tagName.toLowerCase()
}

export function getCssSelector(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el
  while (current && current !== document.body && parts.length < 5) {
    let selector = current.tagName.toLowerCase()
    if (current.id) {
      selector = `#${current.id}`
      parts.unshift(selector)
      break
    }
    const classNames = Array.from(current.classList)
      .filter(c => !c.startsWith('mtb-'))
      .slice(0, 2)
      .join('.')
    if (classNames) selector += `.${classNames}`

    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === current!.tagName,
      )
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1
        selector += `:nth-of-type(${idx})`
      }
    }

    parts.unshift(selector)
    current = current.parentElement
  }
  return parts.join(' > ')
}
