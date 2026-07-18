import { errorSource } from './error-source'

export type FrustrationSignal =
  | 'rage_click'
  | 'dead_click'
  | 'rapid_navigation'
  | 'form_failure'
  | 'error_page'
  | 'dead_click_dom'

export interface FrustrationEvent {
  signal: FrustrationSignal
  target?: string
  detail?: string
  timestamp: number
}

interface ClickRecord {
  target: EventTarget | null
  time: number
}

const RAGE_CLICK_THRESHOLD = 3
const RAGE_CLICK_WINDOW_MS = 1000
const RAPID_NAV_THRESHOLD = 3
const RAPID_NAV_WINDOW_MS = 5000
const FORM_CHECK_DELAY_MS = 500
const DEAD_CLICK_DOM_DELAY_MS = 500
const ERROR_PAGE_CHECK_DELAY_MS = 300

const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'DETAILS',
])

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option',
  'switch', 'textbox', 'combobox', 'listbox', 'slider', 'spinbutton',
])

const ERROR_PAGE_PATTERNS = [
  '404', '500', 'not found', 'page not found',
  'server error', 'internal server error',
]

export class FrustrationDetector {
  private clickHistory: ClickRecord[] = []
  private onFrustration: (event: FrustrationEvent) => void
  private boundClickHandler: (e: MouseEvent) => void
  private unsubscribeErrors: (() => void) | null = null
  private active = false
  private errorCount = 0
  private deadClickCount = 0
  private cooldownUntil = 0
  private static readonly COOLDOWN_MS = 60_000

  private navTimestamps: number[] = []
  private boundPopstateHandler: (() => void) | null = null
  private originalPushState: History['pushState'] | null = null
  private originalReplaceState: History['replaceState'] | null = null
  private installedPushState: History['pushState'] | null = null
  private installedReplaceState: History['replaceState'] | null = null
  private boundSubmitHandler: ((e: Event) => void) | null = null
  private boundInvalidHandler: ((e: Event) => void) | null = null
  private errorPageUrls = new Set<string>()
  private domObserver: MutationObserver | null = null
  private pendingDomChecks = 0
  private lastMutationAt = -1

  constructor(onFrustration: (event: FrustrationEvent) => void) {
    this.onFrustration = onFrustration
    this.boundClickHandler = (e: MouseEvent) => this.handleClick(e)
  }

  start(): void {
    if (this.active) return
    this.active = true
    document.addEventListener('click', this.boundClickHandler, true)
    this.unsubscribeErrors = errorSource.subscribe((_e) => {
      this.errorCount++
    })

    this.startNavigationTracking()
    this.startFormTracking()
    this.checkErrorPage()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    document.removeEventListener('click', this.boundClickHandler, true)
    this.unsubscribeErrors?.()
    this.unsubscribeErrors = null
    this.clickHistory = []

    this.stopNavigationTracking()
    this.stopFormTracking()
    this.errorPageUrls.clear()

    this.disconnectDomObserver()
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
    this.navTimestamps = []
  }

  private startFormTracking(): void {
    this.boundSubmitHandler = (e: Event) => this.handleFormSubmit(e)
    this.boundInvalidHandler = (e: Event) => this.handleFormInvalid(e)
    document.addEventListener('submit', this.boundSubmitHandler, true)
    document.addEventListener('invalid', this.boundInvalidHandler, true)
  }

  private stopFormTracking(): void {
    if (this.boundSubmitHandler) {
      document.removeEventListener('submit', this.boundSubmitHandler, true)
      this.boundSubmitHandler = null
    }
    if (this.boundInvalidHandler) {
      document.removeEventListener('invalid', this.boundInvalidHandler, true)
      this.boundInvalidHandler = null
    }
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as Element | null
    if (!target) return

    if (this.isWidgetElement(target)) return

    const now = Date.now()
    this.clickHistory.push({ target, time: now })

    const cutoff = now - RAGE_CLICK_WINDOW_MS
    this.clickHistory = this.clickHistory.filter(r => r.time > cutoff)

    const sameTargetClicks = this.clickHistory.filter(r => r.target === target)
    if (sameTargetClicks.length >= RAGE_CLICK_THRESHOLD) {
      this.clickHistory = []
      this.emitHighPriority({
        signal: 'rage_click',
        target: describeElement(target),
        timestamp: now,
      })
      return
    }

    if (!this.isInteractive(target)) {
      this.deadClickCount++
      if (this.deadClickCount >= 3 && this.errorCount > 0) {
        this.deadClickCount = 0
        this.errorCount = 0
        this.emitIfReady({
          signal: 'dead_click',
          target: describeElement(target),
          timestamp: now,
        })
      }
    }

    this.checkDeadClickDom(target, now)
  }

  private handleNavigation(): void {
    const now = Date.now()
    this.navTimestamps.push(now)
    const cutoff = now - RAPID_NAV_WINDOW_MS
    this.navTimestamps = this.navTimestamps.filter(t => t > cutoff)
    if (this.navTimestamps.length >= RAPID_NAV_THRESHOLD) {
      this.navTimestamps = []
      this.emitIfReady({
        signal: 'rapid_navigation',
        timestamp: now,
      })
    }
    setTimeout(() => {
      if (this.active) this.checkErrorPage()
    }, ERROR_PAGE_CHECK_DELAY_MS)
  }

  private handleFormSubmit(e: Event): void {
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    if (this.isWidgetElement(form)) return

    setTimeout(() => {
      if (!this.active) return
      if (form.querySelector('[aria-invalid="true"], .is-invalid')) {
        this.emitIfReady({
          signal: 'form_failure',
          target: describeElement(form),
          timestamp: Date.now(),
        })
      }
    }, FORM_CHECK_DELAY_MS)
  }

  private handleFormInvalid(e: Event): void {
    const el = e.target as Element | null
    if (!el) return
    if (this.isWidgetElement(el)) return
    const form = el.closest('form')
    this.emitIfReady({
      signal: 'form_failure',
      target: form ? describeElement(form) : describeElement(el),
      timestamp: Date.now(),
    })
  }

  private checkErrorPage(): void {
    const url = location.href
    if (this.errorPageUrls.has(url)) return

    const title = document.title.toLowerCase()
    if (ERROR_PAGE_PATTERNS.some(p => title.includes(p))) {
      this.errorPageUrls.add(url)
      this.emitHighPriority({
        signal: 'error_page',
        detail: document.title,
        timestamp: Date.now(),
      })
      return
    }

    const candidates = document.querySelectorAll(
      'h1, h2, [class*="error"], [class*="not-found"], [id*="error"], [id*="not-found"]'
    )
    for (const el of candidates) {
      const text = el.textContent ?? ''
      if (text.length < 200 && ERROR_PAGE_PATTERNS.some(p => text.toLowerCase().includes(p))) {
        this.errorPageUrls.add(url)
        this.emitHighPriority({
          signal: 'error_page',
          detail: text.trim().slice(0, 60),
          timestamp: Date.now(),
        })
        return
      }
    }
  }

  // One shared observer for all in-flight dead-click checks, connected only
  // while at least one check is pending — a full-page observer per click was
  // too heavy on mutation-busy pages.
  private checkDeadClickDom(target: Element, clickTime: number): void {
    if (!this.looksInteractive(target)) return

    this.pendingDomChecks++
    this.ensureDomObserver()

    setTimeout(() => {
      this.pendingDomChecks--
      const mutated = this.lastMutationAt >= clickTime
      if (this.pendingDomChecks === 0) this.disconnectDomObserver()

      if (!mutated && this.active) {
        this.emitIfReady({
          signal: 'dead_click_dom',
          target: describeElement(target),
          timestamp: clickTime,
        })
      }
    }, DEAD_CLICK_DOM_DELAY_MS)
  }

  private ensureDomObserver(): void {
    if (this.domObserver) return
    this.domObserver = new MutationObserver(() => {
      this.lastMutationAt = Date.now()
    })
    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  }

  private disconnectDomObserver(): void {
    this.domObserver?.disconnect()
    this.domObserver = null
  }

  private looksInteractive(el: Element): boolean {
    const style = window.getComputedStyle(el)
    if (style.cursor === 'pointer') return true

    if (el.classList) {
      for (const cls of el.classList) {
        const lower = cls.toLowerCase()
        if (lower.includes('btn') || lower.includes('button')) return true
      }
    }

    return false
  }

  private isInteractive(el: Element): boolean {
    if (INTERACTIVE_TAGS.has(el.tagName)) return true

    const role = el.getAttribute('role')
    if (role && INTERACTIVE_ROLES.has(role)) return true

    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true
    if ((el as HTMLElement).contentEditable === 'true') return true

    const style = window.getComputedStyle(el)
    if (style.cursor === 'pointer') return true

    const parent = el.closest('a, button, [role="button"], [role="link"], label')
    if (parent) return true

    return false
  }

  private isWidgetElement(el: Element): boolean {
    const host = document.getElementById('mtb-widget-host')
    if (!host) return false
    return host === el || host.contains(el)
  }

  private emitIfReady(event: FrustrationEvent): void {
    const now = Date.now()
    if (now < this.cooldownUntil) return
    this.cooldownUntil = now + FrustrationDetector.COOLDOWN_MS
    this.onFrustration(event)
  }

  private emitHighPriority(event: FrustrationEvent): void {
    this.cooldownUntil = Date.now() + FrustrationDetector.COOLDOWN_MS
    this.onFrustration(event)
  }
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : ''
  const text = el.textContent?.trim().slice(0, 30) ?? ''
  return `<${tag}${id}${cls}>${text ? ` "${text}"` : ''}`
}
