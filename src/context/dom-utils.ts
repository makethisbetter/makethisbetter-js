export const WIDGET_HOST_ID = 'mtb-widget-host'

export function isWidgetElement(el: Element): boolean {
  const host = document.getElementById(WIDGET_HOST_ID)
  if (!host) return false
  return host === el || host.contains(el)
}

// Skips the widget host via elementsFromPoint instead of toggling its
// display — hiding the host on every mousemove flickered the toolbar.
export function elementUnderPoint(x: number, y: number): Element | null {
  return document.elementsFromPoint?.(x, y).find(el => el.id !== WIDGET_HOST_ID) ?? null
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// A keydown fired mid-IME-composition confirms a candidate, not the widget
// action bound to the key — acting on it would eat what a reporter typing
// Chinese or Japanese meant as text. Some browsers reset isComposing before
// the keydown reaches a capture handler but retain the legacy IME sentinel
// in keyCode.
export function isImeConfirmKeydown(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

// textContent counts the source of <style> and <script> children as text. A
// page with an inline stylesheet in its header therefore names that header
// after its own CSS, and that name travels into the pin, the report, and the
// triage prompt. Only what a reader would see counts.
const UNRENDERED = /^(script|style|noscript|template)$/i

function renderedText(el: Element, limit = 80): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (out.length >= limit) break

    if (node.nodeType === 3) {
      out += node.nodeValue ?? ''
    } else if (node instanceof Element && !UNRENDERED.test(node.tagName)) {
      out += renderedText(node, limit - out.length)
    }
  }
  return out
}

export function getElementName(el: Element): string {
  if (el instanceof HTMLElement) {
    const label = el.getAttribute('aria-label')
    if (label) return label

    const title = el.getAttribute('title')
    if (title) return title

    const text = renderedText(el).trim().slice(0, 40)
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
