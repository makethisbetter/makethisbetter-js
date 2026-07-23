import { errorSource, type ErrorSourceEvent } from './error-source'
import { getCssSelector, getElementName } from '../annotate/highlighter'
import { isWidgetElement } from './dom-utils'
import type { Breadcrumb } from '../types'

const MAX_BREADCRUMBS = 20

export class BreadcrumbCollector {
  private breadcrumbs: Breadcrumb[] = []
  private active = false
  private unsubscribeErrors: (() => void) | null = null
  private boundClickHandler: (e: MouseEvent) => void
  private boundChangeHandler: (e: Event) => void
  private boundPopstateHandler: (() => void) | null = null
  private originalPushState: History['pushState'] | null = null
  private originalReplaceState: History['replaceState'] | null = null
  private installedPushState: History['pushState'] | null = null
  private installedReplaceState: History['replaceState'] | null = null
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
    this.startNavigationTracking()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    document.removeEventListener('click', this.boundClickHandler, true)
    document.removeEventListener('change', this.boundChangeHandler, true)
    this.unsubscribeErrors?.()
    this.unsubscribeErrors = null
    this.stopNavigationTracking()
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
        message: getElementName(target),
        data: { selector: getCssSelector(target) },
      })
    } catch { /* never propagate into host page */ }
  }

  private handleChange(e: Event): void {
    const target = e.target as Element | null
    if (!target) return
    if (isWidgetElement(target)) return

    try {
      const input = target as HTMLInputElement
      const field = input.name || input.placeholder || target.getAttribute('aria-label') || target.tagName
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
    this.add({
      type: 'console',
      category: 'console.error',
      timestamp: Date.now(),
      message: e.message,
      data: { message: e.message },
    })
  }

  private startNavigationTracking(): void {
    this.boundPopstateHandler = () => this.handleNavigation()
    window.addEventListener('popstate', this.boundPopstateHandler)

    this.originalPushState = history.pushState.bind(history)
    this.originalReplaceState = history.replaceState.bind(history)
    const pushOrig = this.originalPushState
    const replaceOrig = this.originalReplaceState
    const onNav = () => this.handleNavigation()

    this.installedPushState = function (data: unknown, unused: string, url?: string | URL | null) {
      pushOrig(data, unused, url)
      onNav()
    }
    this.installedReplaceState = function (data: unknown, unused: string, url?: string | URL | null) {
      replaceOrig(data, unused, url)
      onNav()
    }
    history.pushState = this.installedPushState
    history.replaceState = this.installedReplaceState
  }

  private stopNavigationTracking(): void {
    if (this.boundPopstateHandler) {
      window.removeEventListener('popstate', this.boundPopstateHandler)
      this.boundPopstateHandler = null
    }
    // Only restore if nothing (e.g. an SPA router) re-wrapped the functions
    // after us — restoring the stale snapshot would discard their wrapper.
    if (this.originalPushState && history.pushState === this.installedPushState) {
      history.pushState = this.originalPushState
    }
    if (this.originalReplaceState && history.replaceState === this.installedReplaceState) {
      history.replaceState = this.originalReplaceState
    }
    this.originalPushState = null
    this.originalReplaceState = null
    this.installedPushState = null
    this.installedReplaceState = null
  }

  private handleNavigation(): void {
    if (!this.active) return
    const from = this.lastUrl
    const to = location.href
    if (from === to) return
    this.lastUrl = to
    this.add({
      type: 'navigation',
      category: 'navigation',
      timestamp: Date.now(),
      message: `${from} → ${to}`,
      data: { from, to },
    })
  }

}
