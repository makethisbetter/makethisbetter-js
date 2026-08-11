import { errorSource } from './error-source'
import { isWidgetElement } from './dom-utils'
import { onHistoryNavigation } from './history-patch'
import type { HistoryNavigationEvent } from './history-patch'
import { loadFrustrationState, saveFrustrationState } from './frustration-state'

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

const RAGE_CLICK_THRESHOLD = 4
const RAGE_CLICK_WINDOW_MS = 1500
const RAPID_NAV_THRESHOLD = 3
const RAPID_NAV_WINDOW_MS = 5000
const FORM_CHECK_DELAY_MS = 500
const FORM_FAILURE_THRESHOLD = 2
const FORM_FAILURE_WINDOW_MS = 30_000
const INTERACTION_ERROR_WINDOW_MS = 2000
const DEAD_CLICK_DOM_DELAY_MS = 1000
const ERROR_PAGE_CHECK_DELAY_MS = 300

const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'DETAILS',
])

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option',
  'switch', 'textbox', 'combobox', 'listbox', 'slider', 'spinbutton',
])

const COMMAND_TAGS = new Set(['A', 'BUTTON', 'SUMMARY'])
const COMMAND_ROLES = new Set(['button', 'link', 'tab', 'menuitem'])

// Matched as whole words, never as substrings. Substring matching read the
// '500' in "Top 500 SaaS Tools" as an outage and put the high-priority prompt
// in front of every visitor on load.
//
// A bare status code stays ambiguous even with word boundaries — it is a
// listicle count, a company name, a price — so it only counts when the title is
// nothing but the code, or an explicit error word stands next to it. The
// phrases are error-shaped on their own and carry themselves.
const ERROR_PAGE_PATTERNS = [
  /\bnot found\b/,
  /\bserver error\b/,
  /^\s*(?:http\s*)?[45]\d{2}\s*$/,
  /\b(?:error|http|status)\s*[:-]?\s*[45]\d{2}\b/,
  /\b[45]\d{2}\s*[:-]?\s*error\b/,
]

export class FrustrationDetector {
  private clickHistory: ClickRecord[] = []
  private onFrustration: (event: FrustrationEvent) => void
  private boundClickHandler: (e: MouseEvent) => void
  private unsubscribeErrors: (() => void) | null = null
  private active = false
  private lastInteraction: { target: Element; time: number } | null = null
  private cooldownUntil = 0
  private static readonly COOLDOWN_MS = 60_000

  private navTimestamps: number[] = []
  private unsubscribeNavigation: (() => void) | null = null
  private boundPageLeaveHandler: (() => void) | null = null
  private boundTurboNavigationHandler: (() => void) | null = null
  private lastNavigationAt = -1
  private boundSubmitHandler: ((e: Event) => void) | null = null
  private boundInvalidHandler: ((e: Event) => void) | null = null
  private recentSubmitForms = new WeakSet<HTMLFormElement>()
  private recentFailedForms = new WeakSet<HTMLFormElement>()
  private formFailureTimestamps = new WeakMap<HTMLFormElement, number[]>()
  private errorPageUrls = new Set<string>()
  private domObserver: MutationObserver | null = null
  private pendingDomChecks = 0
  private lastMutationAt = -1

  // Every deferred check outlives the interaction that scheduled it, so stop()
  // has to cancel the ones still waiting. Two reasons: a dead-click timer holds
  // the clicked host element for a second past teardown, and a start() inside
  // that window would let the previous session's click emit against the new one.
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(onFrustration: (event: FrustrationEvent) => void) {
    this.onFrustration = onFrustration
    this.boundClickHandler = (e: MouseEvent) => this.handleClick(e)
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.restoreState()
    document.addEventListener('click', this.boundClickHandler, true)
    this.unsubscribeErrors = errorSource.subscribe(() => {
      const now = Date.now()
      if (!this.lastInteraction || now - this.lastInteraction.time > INTERACTION_ERROR_WINDOW_MS) return

      const interaction = this.lastInteraction
      this.lastInteraction = null
      this.emitIfReady({
        signal: 'dead_click',
        target: describeElement(interaction.target),
        detail: 'Uncaught error after interaction',
        timestamp: now,
      })
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
    this.lastInteraction = null

    this.stopNavigationTracking()
    this.stopFormTracking()
    this.errorPageUrls.clear()

    this.clearPendingTimers()
    // The cancelled dead-click timers are the only thing that would have
    // decremented this, so the count has to come back to zero by hand or the
    // observer of a restarted detector never reaches its disconnect condition.
    this.pendingDomChecks = 0
    this.disconnectDomObserver()
  }

  private schedule(callback: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer)
      callback()
    }, delayMs)
    this.pendingTimers.add(timer)
  }

  private clearPendingTimers(): void {
    for (const timer of this.pendingTimers) clearTimeout(timer)
    this.pendingTimers.clear()
  }

  private startNavigationTracking(): void {
    this.unsubscribeNavigation = onHistoryNavigation((event) => this.handleNavigation(event))

    // A click that starts a full-page navigation (checkout, OAuth, external
    // link, download, window.location assignment) leaves the DOM untouched
    // while the browser tears the page down, which is indistinguishable from a
    // dead click by mutation alone. Recording when the page starts leaving lets
    // checkDeadClickDom acquit those clicks. Both events are needed: browsers
    // skip beforeunload when nothing registered an unload prompt, and Safari
    // reaches bfcache via pagehide only.
    this.boundPageLeaveHandler = () => this.noteNavigationStarted()
    window.addEventListener('beforeunload', this.boundPageLeaveHandler)
    window.addEventListener('pagehide', this.boundPageLeaveHandler)
    this.boundTurboNavigationHandler = () => this.noteNavigationStarted()
    document.addEventListener('turbo:before-visit', this.boundTurboNavigationHandler)
    document.addEventListener('turbo:submit-start', this.boundTurboNavigationHandler)
    document.addEventListener('turbo:before-fetch-request', this.boundTurboNavigationHandler)
  }

  private stopNavigationTracking(): void {
    this.unsubscribeNavigation?.()
    this.unsubscribeNavigation = null
    this.navTimestamps = []

    if (this.boundPageLeaveHandler) {
      window.removeEventListener('beforeunload', this.boundPageLeaveHandler)
      window.removeEventListener('pagehide', this.boundPageLeaveHandler)
      this.boundPageLeaveHandler = null
    }
    if (this.boundTurboNavigationHandler) {
      document.removeEventListener('turbo:before-visit', this.boundTurboNavigationHandler)
      document.removeEventListener('turbo:submit-start', this.boundTurboNavigationHandler)
      document.removeEventListener('turbo:before-fetch-request', this.boundTurboNavigationHandler)
      this.boundTurboNavigationHandler = null
    }
    this.lastNavigationAt = -1
  }

  private noteNavigationStarted(): void {
    this.lastNavigationAt = Date.now()
  }

  // Rehydrates the state a Turbo Drive visit would otherwise reset. Without this,
  // a fresh detector on every page starts with an empty nav history (so
  // `rapid_navigation` can never reach its 3-in-5s threshold), no cooldown, and no
  // memory of which error pages it already reported.
  private restoreState(): void {
    const stored = loadFrustrationState()
    this.navTimestamps = stored.navTimestamps
    this.cooldownUntil = stored.cooldownUntil
    this.errorPageUrls = new Set(stored.errorPageUrls)
  }

  private persistState(): void {
    const stored = loadFrustrationState()
    saveFrustrationState({
      ...stored,
      navTimestamps: this.navTimestamps,
      cooldownUntil: this.cooldownUntil,
      errorPageUrls: [...this.errorPageUrls],
    })
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
    // Their expiry timers were just cancelled, so membership would otherwise be
    // permanent and a form left mid-submit here would be judged failed by a
    // later detector on the strength of an attempt from the previous one.
    this.recentSubmitForms = new WeakSet()
    this.recentFailedForms = new WeakSet()
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as Element | null
    if (!target) return

    if (isWidgetElement(target)) return
    this.trackFormSubmitIntent(target)
    this.trackNativeNavigationIntent(e, target)
    const interactionTarget = this.interactionTarget(target)

    const now = Date.now()
    this.lastInteraction = { target: interactionTarget, time: now }
    this.clickHistory.push({ target: interactionTarget, time: now })

    const cutoff = now - RAGE_CLICK_WINDOW_MS
    this.clickHistory = this.clickHistory.filter(r => r.time > cutoff)

    const sameTargetClicks = this.clickHistory.filter(r => r.target === interactionTarget)
    if (sameTargetClicks.length >= RAGE_CLICK_THRESHOLD) {
      this.clickHistory = []
      this.emitHighPriority({
        signal: 'rage_click',
        target: describeElement(interactionTarget),
        timestamp: now,
      })
      return
    }

    this.checkDeadClickDom(interactionTarget, now)
  }

  private handleNavigation(event: HistoryNavigationEvent): void {
    const now = Date.now()
    this.noteNavigationStarted()
    const meaningfulNavigation = event.type !== 'replace' && event.fromUrl !== event.toUrl
    // Successful forward navigation is ordinary browsing, even when several
    // pages are opened quickly. Repeated browser back/forward movement is the
    // narrower signal that the visitor may be struggling to find their way.
    if (meaningfulNavigation && event.type === 'pop') {
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
    }
    this.persistState()
    this.schedule(() => {
      if (this.active) this.checkErrorPage()
    }, ERROR_PAGE_CHECK_DELAY_MS)
  }

  private handleFormSubmit(e: Event): void {
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    if (isWidgetElement(form)) return

    this.rememberSubmitAttempt(form)

    this.schedule(() => {
      if (!this.active) return
      if (form.querySelector('[aria-invalid="true"], .is-invalid')) {
        this.recordFormFailure(form)
      }
    }, FORM_CHECK_DELAY_MS)
  }

  private trackFormSubmitIntent(target: Element): void {
    const control = target.closest('button, input')
    if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement)) return
    if (control.type !== 'submit' && control.type !== 'image') return
    if (!control.form || isWidgetElement(control.form)) return

    this.rememberSubmitAttempt(control.form)
  }

  private trackNativeNavigationIntent(event: MouseEvent, target: Element): void {
    if (!target.closest('a[href]')) return

    queueMicrotask(() => {
      if (this.active && !event.defaultPrevented) this.noteNavigationStarted()
    })
  }

  private rememberSubmitAttempt(form: HTMLFormElement): void {
    this.recentSubmitForms.add(form)
    this.schedule(() => {
      this.recentSubmitForms.delete(form)
    }, FORM_CHECK_DELAY_MS)
  }

  private recordFormFailure(form: HTMLFormElement): void {
    if (this.recentFailedForms.has(form)) return
    this.recentFailedForms.add(form)
    this.schedule(() => this.recentFailedForms.delete(form), FORM_CHECK_DELAY_MS)

    const now = Date.now()
    const cutoff = now - FORM_FAILURE_WINDOW_MS
    const failures = (this.formFailureTimestamps.get(form) ?? []).filter(timestamp => timestamp > cutoff)
    failures.push(now)
    this.formFailureTimestamps.set(form, failures)
    if (failures.length < FORM_FAILURE_THRESHOLD) return

    this.formFailureTimestamps.set(form, [])
    this.emitIfReady({
      signal: 'form_failure',
      target: describeElement(form),
      timestamp: now,
    })
  }

  private handleFormInvalid(e: Event): void {
    const el = e.target as Element | null
    if (!el) return
    if (isWidgetElement(el)) return
    const form = el.closest('form')
    if (!form || !this.recentSubmitForms.has(form)) return
    this.recordFormFailure(form)
  }

  private checkErrorPage(): void {
    const url = location.href
    if (this.errorPageUrls.has(url)) return

    const title = document.title.toLowerCase()
    if (ERROR_PAGE_PATTERNS.some(p => p.test(title))) {
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
      if (text.length < 200 && ERROR_PAGE_PATTERNS.some(p => p.test(text.toLowerCase()))) {
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

    this.schedule(() => {
      this.pendingDomChecks--
      const mutated = this.lastMutationAt >= clickTime
      // A navigation that began at or after the click means the click worked;
      // the page just left before it could mutate anything.
      const navigated = this.lastNavigationAt >= clickTime
      if (this.pendingDomChecks === 0) this.disconnectDomObserver()

      if (!mutated && !navigated && this.active) {
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
    this.domObserver.observe(document.documentElement, {
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
    if (COMMAND_TAGS.has(el.tagName) || el.hasAttribute('onclick')) return true

    const role = el.getAttribute('role')
    if (role && COMMAND_ROLES.has(role)) return true

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

  private interactionTarget(el: Element): Element {
    let current: Element | null = el
    while (current && current !== document.body) {
      if (this.isIntrinsicInteractive(current)) return current
      current = current.parentElement
    }

    let candidate = el
    current = el.parentElement
    while (current && current !== document.body && this.looksInteractive(current)) {
      candidate = current
      current = current.parentElement
    }
    return candidate
  }

  private isIntrinsicInteractive(el: Element): boolean {
    if (INTERACTIVE_TAGS.has(el.tagName)) return true

    const role = el.getAttribute('role')
    if (role && INTERACTIVE_ROLES.has(role)) return true

    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true
    return (el as HTMLElement).contentEditable === 'true'
  }

  private emitIfReady(event: FrustrationEvent): void {
    const now = Date.now()
    if (now < this.cooldownUntil) return
    this.cooldownUntil = now + FrustrationDetector.COOLDOWN_MS
    this.persistState()
    this.onFrustration(event)
  }

  private emitHighPriority(event: FrustrationEvent): void {
    this.cooldownUntil = Date.now() + FrustrationDetector.COOLDOWN_MS
    this.persistState()
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
