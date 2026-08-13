import { errorSource, type ErrorSourceEvent } from './error-source'
import { summarizeError } from './error-summary'
import { getCssSelector, getElementName, isWidgetElement } from './dom-utils'
import { onHistoryNavigation } from './history-patch'
import { isPrivacyProtected, structuralElementName, structuralElementSelector } from '../privacy/dom'
import { sanitizeUrl } from '../privacy/sanitize'
import type { Breadcrumb } from '../types'

const MAX_BREADCRUMBS = 20
// A click breadcrumb names the element by its on-screen text, which on a page
// showing an order total or a patient name is that value verbatim. The replay
// recorder already honours rr-block/rr-mask for exactly this; a customer who
// marked a region has marked it for the whole SDK, not for replays only. Inside
// one, fall back to what the element is rather than what it says.
function describeTarget(el: Element): string {
  if (isPrivacyProtected(el)) return structuralElementName(el)
  return getElementName(el)
}

function describeSelector(el: Element): string {
  return isPrivacyProtected(el) ? structuralElementSelector(el) : getCssSelector(el)
}

export class BreadcrumbCollector {
  private breadcrumbs: Breadcrumb[] = []
  private active = false
  private unsubscribeErrors: (() => void) | null = null
  private boundClickHandler: (e: MouseEvent) => void
  private boundChangeHandler: (e: Event) => void
  private unsubscribeNavigation: (() => void) | null = null
  private lastUrl = ''

  constructor() {
    this.boundClickHandler = (e: MouseEvent) => this.handleClick(e)
    this.boundChangeHandler = (e: Event) => this.handleChange(e)
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.lastUrl = location.href
    document.addEventListener('click', this.boundClickHandler, { capture: true, passive: true })
    document.addEventListener('change', this.boundChangeHandler, { capture: true, passive: true })
    this.unsubscribeErrors = errorSource.subscribe((e) => this.recordError(e))
    this.unsubscribeNavigation = onHistoryNavigation(() => this.handleNavigation())
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    document.removeEventListener('click', this.boundClickHandler, true)
    document.removeEventListener('change', this.boundChangeHandler, true)
    this.unsubscribeErrors?.()
    this.unsubscribeErrors = null
    this.unsubscribeNavigation?.()
    this.unsubscribeNavigation = null
  }

  getBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbs]
  }

  private add(crumb: Breadcrumb): void {
    this.breadcrumbs.push(crumb)
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.breadcrumbs.shift()
    }
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as Element | null
    if (!target) return
    if (isWidgetElement(target)) return

    try {
      this.add({
        type: 'ui',
        category: 'ui.click',
        timestamp: Date.now(),
        message: describeTarget(target),
        data: { selector: describeSelector(target) },
      })
    } catch { /* never propagate into host page */ }
  }

  private handleChange(e: Event): void {
    const target = e.target as Element | null
    if (!target) return
    if (isWidgetElement(target)) return

    try {
      const input = target as HTMLInputElement
      const field = isPrivacyProtected(target)
        ? structuralElementName(target)
        : input.name || input.placeholder || target.getAttribute('aria-label') || target.tagName
      this.add({
        type: 'ui',
        category: 'ui.input',
        timestamp: Date.now(),
        message: field,
        data: { field },
      })
    } catch { /* never propagate into host page */ }
  }

  private recordError(e: ErrorSourceEvent): void {
    const summary = summarizeError(e)
    this.add({
      type: 'console',
      category: 'console.error',
      timestamp: Date.now(),
      message: summary,
      data: { message: summary },
    })
  }

  private handleNavigation(): void {
    if (!this.active) return
    const from = this.lastUrl
    const to = location.href
    if (from === to) return
    this.lastUrl = to
    const sanitizedFrom = sanitizeUrl(from)
    const sanitizedTo = sanitizeUrl(to)
    this.add({
      type: 'navigation',
      category: 'navigation',
      timestamp: Date.now(),
      message: `${sanitizedFrom} → ${sanitizedTo}`,
      data: { from: sanitizedFrom, to: sanitizedTo },
    })
  }

}
