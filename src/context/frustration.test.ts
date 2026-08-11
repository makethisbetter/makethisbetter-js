import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { FrustrationDetector, FrustrationEvent } from './frustration'
import { clearFrustrationState, loadFrustrationState } from './frustration-state'

describe('FrustrationDetector', () => {
  let detector: FrustrationDetector
  let events: FrustrationEvent[]
  let nativePushState: History['pushState']

  beforeEach(() => {
    vi.useFakeTimers()
    // Cooldown, nav history and reported error pages now survive a detector's
    // lifetime on purpose (see frustration-state.ts), so each case starts clean.
    clearFrustrationState()
    nativePushState = history.pushState
  })

  afterEach(() => {
    detector?.stop()
    clearFrustrationState()
    vi.useRealTimers()
  })

  function makeDetector(): FrustrationDetector {
    events = []
    detector = new FrustrationDetector((e) => events.push(e))
    detector.start()
    return detector
  }

  it('detects rage clicks after four clicks on the same element within 1.5s', () => {
    makeDetector()
    const div = document.createElement('div')
    div.textContent = 'static text'
    document.body.appendChild(div)

    for (let i = 0; i < 3; i++) {
      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }

    expect(events.filter(e => e.signal === 'rage_click')).toHaveLength(0)

    vi.advanceTimersByTime(1400)
    div.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const rageEvents = events.filter(e => e.signal === 'rage_click')
    expect(rageEvents.length).toBe(1)
    expect(rageEvents[0].target).toContain('div')

    document.body.removeChild(div)
  })

  it('groups clicks on different children of the same interactive control', () => {
    makeDetector()
    const button = document.createElement('button')
    const icon = document.createElement('span')
    const label = document.createElement('span')
    icon.textContent = '!'
    label.textContent = 'Retry'
    button.append(icon, label)
    document.body.appendChild(button)

    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const rageEvents = events.filter(e => e.signal === 'rage_click')
    expect(rageEvents).toHaveLength(1)
    expect(rageEvents[0].target).toContain('button')

    document.body.removeChild(button)
  })

  it('does not emit an interaction error from an ordinary click', () => {
    makeDetector()
    const p = document.createElement('p')
    p.textContent = 'just a paragraph'
    document.body.appendChild(p)

    p.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const deadClicks = events.filter(e => e.signal === 'dead_click')
    expect(deadClicks.length).toBe(0)

    document.body.removeChild(p)
  })

  it('does not fire dead click for interactive elements', () => {
    makeDetector()
    const btn = document.createElement('button')
    btn.textContent = 'Click me'
    document.body.appendChild(btn)

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const deadClicks = events.filter(e => e.signal === 'dead_click')
    expect(deadClicks.length).toBe(0)

    document.body.removeChild(btn)
  })

  it('does not fire dead click for links', () => {
    makeDetector()
    const link = document.createElement('a')
    link.href = '#'
    link.textContent = 'Link'
    document.body.appendChild(link)

    link.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const deadClicks = events.filter(e => e.signal === 'dead_click')
    expect(deadClicks.length).toBe(0)

    document.body.removeChild(link)
  })

  it('detects an uncaught runtime error immediately after an interaction', () => {
    makeDetector()
    const button = document.createElement('button')
    button.textContent = 'Save'
    document.body.appendChild(button)

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    if (window.onerror) {
      ;(window.onerror as Function)('Save failed', 'app.js', 1, 1, new Error('Save failed'))
    }

    const deadClicks = events.filter(e => e.signal === 'dead_click')
    expect(deadClicks).toHaveLength(1)
    expect(deadClicks[0].target).toContain('button')

    document.body.removeChild(button)
  })

  it('does not combine an old unrelated error with later non-interactive clicks', () => {
    makeDetector()
    if (window.onerror) {
      ;(window.onerror as Function)('Boot warning', 'app.js', 1, 1, new Error('Boot warning'))
    }
    vi.advanceTimersByTime(2001)

    const paragraph = document.createElement('p')
    paragraph.textContent = 'Selectable text'
    document.body.appendChild(paragraph)
    for (let i = 0; i < 3; i++) {
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }

    expect(events.filter(e => e.signal === 'dead_click')).toHaveLength(0)

    document.body.removeChild(paragraph)
  })

  it('rage clicks always trigger (high priority, ignores cooldown)', () => {
    makeDetector()
    const div = document.createElement('div')
    div.textContent = 'static'
    document.body.appendChild(div)

    for (let i = 0; i < 4; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(events.length).toBe(1)

    for (let i = 0; i < 4; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(events.length).toBe(2)

    document.body.removeChild(div)
  })

  it('ignores clicks on widget host element', () => {
    makeDetector()
    const host = document.createElement('div')
    host.id = 'mtb-widget-host'
    const inner = document.createElement('span')
    inner.textContent = 'widget element'
    host.appendChild(inner)
    document.body.appendChild(host)

    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(events.length).toBe(0)

    document.body.removeChild(host)
  })

  it('does not emit an interaction error without a recent interaction', () => {
    makeDetector()

    if (window.onerror) {
      ;(window.onerror as Function)('Test error', 'test.js', 1, 1, new Error('Test error'))
    }

    expect(events.length).toBe(0)
  })

  it('stops listening after stop()', () => {
    makeDetector()
    detector.stop()

    const p = document.createElement('p')
    p.textContent = 'text'
    document.body.appendChild(p)
    p.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(events.length).toBe(0)

    document.body.removeChild(p)
  })

  it('does not replay a check that was still pending when stop() ran', () => {
    makeDetector()
    const fakeButton = document.createElement('div')
    fakeButton.style.cursor = 'pointer'
    fakeButton.textContent = 'fake button'
    document.body.appendChild(fakeButton)
    fakeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // The verdict on this click is still a second away. Whatever brings the
    // detector back — a restart, a Turbo visit — the click belongs to the
    // session that ended, and its deferred check must not outlive it.
    detector.stop()
    events.length = 0
    detector.start()
    vi.advanceTimersByTime(1000)

    expect(events).toEqual([])

    document.body.removeChild(fakeButton)
  })

  describe('rapid_navigation', () => {
    function userNavigate(path: string): void {
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.click()
      history.pushState({}, '', path)
      document.body.removeChild(button)
    }

    function popNavigate(path: string): void {
      nativePushState.call(history, {}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }

    it('ignores programmatic pushState calls without a recent user interaction', () => {
      makeDetector()

      history.pushState({}, '', '/programmatic-1')
      history.pushState({}, '', '/programmatic-2')
      history.pushState({}, '', '/programmatic-3')

      expect(events.filter(e => e.signal === 'rapid_navigation')).toHaveLength(0)
    })

    it('ignores replaceState and same-URL history writes', () => {
      makeDetector()
      const button = document.createElement('button')
      document.body.appendChild(button)

      button.click()
      history.replaceState({}, '', '/filters')
      button.click()
      history.replaceState({}, '', '/filters')
      button.click()
      history.pushState({}, '', '/filters')

      expect(events.filter(e => e.signal === 'rapid_navigation')).toHaveLength(0)

      document.body.removeChild(button)
    })

    it('does not treat successful forward navigation as frustration', () => {
      makeDetector()

      userNavigate('/page1')
      userNavigate('/page2')
      userNavigate('/page3')

      const navEvents = events.filter(e => e.signal === 'rapid_navigation')
      expect(navEvents.length).toBe(0)
    })

    it('detects 3 browser back or forward navigations within 5 seconds', () => {
      makeDetector()

      popNavigate('/history-1')
      popNavigate('/history-2')
      popNavigate('/history-3')

      expect(events.filter(e => e.signal === 'rapid_navigation')).toHaveLength(1)
    })

    // Turbo Drive rebuilds the detector on every visit, so a per-instance nav
    // history could never reach 3 — each visit contributed at most one timestamp
    // before being thrown away, making this signal unreachable.
    it('detects 3 navigations spread across recreated detectors', () => {
      makeDetector()
      popNavigate('/page1')
      detector.stop()

      makeDetector()
      popNavigate('/page2')
      detector.stop()

      makeDetector()
      popNavigate('/page3')

      expect(events.filter(e => e.signal === 'rapid_navigation').length).toBe(1)
    })

    it('still honours the 5s window across recreated detectors', () => {
      makeDetector()
      popNavigate('/page1')
      detector.stop()
      vi.advanceTimersByTime(3000)

      makeDetector()
      popNavigate('/page2')
      detector.stop()
      vi.advanceTimersByTime(3000)

      makeDetector()
      popNavigate('/page3')

      expect(events.filter(e => e.signal === 'rapid_navigation').length).toBe(0)
    })

    it('does not trigger with fewer than 3 navigations', () => {
      makeDetector()

      popNavigate('/page1')
      popNavigate('/page2')

      const navEvents = events.filter(e => e.signal === 'rapid_navigation')
      expect(navEvents.length).toBe(0)
    })

    it('does not trigger when navigations are spread beyond 5s window', () => {
      makeDetector()

      popNavigate('/page1')
      vi.advanceTimersByTime(3000)
      popNavigate('/page2')
      vi.advanceTimersByTime(3000)
      popNavigate('/page3')

      const navEvents = events.filter(e => e.signal === 'rapid_navigation')
      expect(navEvents.length).toBe(0)
    })

    it('restores history.pushState and replaceState after stop', () => {
      const origPush = history.pushState
      const origReplace = history.replaceState
      makeDetector()
      detector.stop()

      expect(typeof history.pushState).toBe('function')
      expect(typeof history.replaceState).toBe('function')
    })

    it('leaves a wrapper installed after start (e.g. an SPA router) in place on stop', () => {
      const nativePush = history.pushState
      const nativeReplace = history.replaceState
      makeDetector()

      const routerPush: History['pushState'] = () => {}
      const routerReplace: History['replaceState'] = () => {}
      history.pushState = routerPush
      history.replaceState = routerReplace

      detector.stop()

      expect(history.pushState).toBe(routerPush)
      expect(history.replaceState).toBe(routerReplace)

      history.pushState = nativePush
      history.replaceState = nativeReplace
    })
  })

  describe('form_failure', () => {
    it('detects repeated HTML5 constraint validation failures from native submit clicks', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      const submit = document.createElement('button')
      input.required = true
      submit.type = 'submit'
      form.appendChild(input)
      form.appendChild(submit)
      document.body.appendChild(form)

      submit.click()

      expect(events.filter(e => e.signal === 'form_failure')).toHaveLength(0)

      vi.advanceTimersByTime(501)
      submit.click()

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(1)
      expect(formEvents[0].target).toContain('form')

      document.body.removeChild(form)
    })

    it('counts one failed attempt when multiple fields are invalid', () => {
      makeDetector()
      const form = document.createElement('form')
      const first = document.createElement('input')
      const second = document.createElement('input')
      const submit = document.createElement('button')
      first.required = true
      second.required = true
      submit.type = 'submit'
      form.append(first, second, submit)
      document.body.appendChild(form)

      submit.click()

      expect(events.filter(e => e.signal === 'form_failure')).toHaveLength(0)

      document.body.removeChild(form)
    })

    it('does not combine form failures more than 30 seconds apart', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      input.required = true
      const submit = document.createElement('button')
      submit.type = 'submit'
      form.append(input, submit)
      document.body.appendChild(form)

      submit.click()
      vi.advanceTimersByTime(30_001)
      submit.click()

      expect(events.filter(e => e.signal === 'form_failure')).toHaveLength(0)

      document.body.removeChild(form)
    })

    it('ignores programmatic invalid events without a preceding submit', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      input.required = true
      form.appendChild(input)
      document.body.appendChild(form)

      input.dispatchEvent(new Event('invalid', { bubbles: true }))

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(0)

      document.body.removeChild(form)
    })

    it('detects validation errors after submit via aria-invalid', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      input.setAttribute('aria-invalid', 'true')
      form.appendChild(input)
      document.body.appendChild(form)

      form.dispatchEvent(new Event('submit', { bubbles: true }))
      vi.advanceTimersByTime(500)

      expect(events.filter(e => e.signal === 'form_failure')).toHaveLength(0)

      vi.advanceTimersByTime(1)
      form.dispatchEvent(new Event('submit', { bubbles: true }))
      vi.advanceTimersByTime(500)

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(1)

      document.body.removeChild(form)
    })

    it('detects validation errors after submit via .is-invalid class', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      input.classList.add('is-invalid')
      form.appendChild(input)
      document.body.appendChild(form)

      form.dispatchEvent(new Event('submit', { bubbles: true }))
      vi.advanceTimersByTime(500)

      expect(events.filter(e => e.signal === 'form_failure')).toHaveLength(0)

      vi.advanceTimersByTime(1)
      form.dispatchEvent(new Event('submit', { bubbles: true }))
      vi.advanceTimersByTime(500)

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(1)

      document.body.removeChild(form)
    })

    it('does not trigger for valid form submissions', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      form.appendChild(input)
      document.body.appendChild(form)

      form.dispatchEvent(new Event('submit', { bubbles: true }))
      vi.advanceTimersByTime(500)

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(0)

      document.body.removeChild(form)
    })

    it('ignores form events inside widget host', () => {
      makeDetector()
      const host = document.createElement('div')
      host.id = 'mtb-widget-host'
      const form = document.createElement('form')
      const input = document.createElement('input')
      input.required = true
      form.appendChild(input)
      host.appendChild(form)
      document.body.appendChild(host)

      input.dispatchEvent(new Event('invalid', { bubbles: true }))

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(0)

      document.body.removeChild(host)
    })
  })

  describe('error_page', () => {
    it('detects error page via document title', () => {
      const originalTitle = document.title
      document.title = '404 - Page Not Found'
      makeDetector()

      const errorEvents = events.filter(e => e.signal === 'error_page')
      expect(errorEvents.length).toBe(1)
      expect(errorEvents[0].detail).toBe('404 - Page Not Found')

      document.title = originalTitle
    })

    it('detects error page via h1 content', () => {
      const h1 = document.createElement('h1')
      h1.textContent = 'Page Not Found'
      document.body.appendChild(h1)

      makeDetector()

      const errorEvents = events.filter(e => e.signal === 'error_page')
      expect(errorEvents.length).toBe(1)

      document.body.removeChild(h1)
    })

    it('detects 500 server error page', () => {
      const originalTitle = document.title
      document.title = '500 Internal Server Error'
      makeDetector()

      const errorEvents = events.filter(e => e.signal === 'error_page')
      expect(errorEvents.length).toBe(1)

      document.title = originalTitle
    })

    it('does not trigger on normal pages', () => {
      const originalTitle = document.title
      document.title = 'My App - Dashboard'
      makeDetector()

      const errorEvents = events.filter(e => e.signal === 'error_page')
      expect(errorEvents.length).toBe(0)

      document.title = originalTitle
    })

    // Patterns used to be substring-matched, so a listicle counted as an
    // outage: every visitor to this page got the high-priority prompt on load.
    it.each([
      'Top 500 SaaS Tools',
      '500 Startups — Portfolio',
      'Room 404 Booking',
      'Pricing: $404 per seat',
    ])('does not trigger on a title that merely contains a number: %s', (title) => {
      const originalTitle = document.title
      document.title = title
      makeDetector()

      expect(events.filter(e => e.signal === 'error_page').length).toBe(0)

      document.title = originalTitle
    })

    // A code carries no phrase of its own, so it needs either the whole title
    // to itself or a word next to it that makes it an error.
    it.each([
      'Error 500',
      '404 Error',
      '500 Error',
      'HTTP 404',
      '404',
    ])('still detects an error-shaped title without a phrase: %s', (title) => {
      const originalTitle = document.title
      document.title = title
      makeDetector()

      expect(events.filter(e => e.signal === 'error_page').length).toBe(1)

      document.title = originalTitle
    })

    // A Turbo Drive visit destroys and rebuilds the detector, so "once per URL"
    // has to hold across detector instances too — otherwise revisiting the same
    // error page prompts the reporter again about something already reported.
    it('only triggers once per URL, including after the detector is recreated', () => {
      const originalTitle = document.title
      document.title = '404 Not Found'
      makeDetector()

      expect(events.filter(e => e.signal === 'error_page').length).toBe(1)

      detector.stop()
      events = []
      detector = new FrustrationDetector((e) => events.push(e))
      detector.start()

      expect(events.filter(e => e.signal === 'error_page').length).toBe(0)

      document.title = originalTitle
    })
  })

  describe('dead_click_dom', () => {
    it('waits one second before detecting an interactive-looking click with no response', () => {
      makeDetector()
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'fake button'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(999)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      vi.advanceTimersByTime(1)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents.length).toBe(1)
      expect(domEvents[0].target).toContain('div')

      document.body.removeChild(div)
    })

    it('does not trigger when DOM mutation occurs after click', async () => {
      makeDetector()
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'working button'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const span = document.createElement('span')
      span.textContent = 'added content'
      document.body.appendChild(span)
      await Promise.resolve()
      vi.advanceTimersByTime(500)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents.length).toBe(0)

      document.body.removeChild(div)
      document.body.removeChild(span)
    })

    it('treats a document-level loading state as a response', async () => {
      makeDetector()
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'Load report'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      document.documentElement.setAttribute('aria-busy', 'true')
      await Promise.resolve()
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      document.documentElement.removeAttribute('aria-busy')
      document.body.removeChild(div)
    })

    it('does not trigger for elements without interactive appearance', () => {
      makeDetector()
      const p = document.createElement('p')
      p.textContent = 'plain text'
      document.body.appendChild(p)

      p.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(500)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents.length).toBe(0)

      document.body.removeChild(p)
    })

    it('detects click on element with button-like class name', () => {
      makeDetector()
      const div = document.createElement('div')
      div.className = 'btn-primary'
      div.textContent = 'styled button'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(1000)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents.length).toBe(1)

      document.body.removeChild(div)
    })

    it('detects an unresponsive semantic button without visual hints', () => {
      makeDetector()
      const button = document.createElement('button')
      button.textContent = 'Retry'
      document.body.appendChild(button)

      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(1000)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents).toHaveLength(1)
      expect(domEvents[0].target).toContain('button')

      document.body.removeChild(button)
    })

    it('does not treat focusing a form control as a dead click', () => {
      makeDetector()
      const input = document.createElement('input')
      document.body.appendChild(input)

      input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      document.body.removeChild(input)
    })

    it('cleans up mutation observers after stop', () => {
      makeDetector()
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'fake button'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      detector.stop()
      vi.advanceTimersByTime(500)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents.length).toBe(0)

      document.body.removeChild(div)
    })

    it('shares one MutationObserver across overlapping clicks and disconnects when done', () => {
      const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe')
      const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')
      makeDetector()
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'fake button'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(100)
      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      expect(observeSpy).toHaveBeenCalledTimes(1)
      expect(disconnectSpy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1000)
      expect(disconnectSpy).toHaveBeenCalledTimes(1)

      document.body.removeChild(div)
      observeSpy.mockRestore()
      disconnectSpy.mockRestore()
    })
  })

  // A click that starts a full-page navigation (checkout, OAuth, external link,
  // download) cannot mutate the DOM — the browser is already leaving. Reported
  // as FB-17: clicking "Pay $20" went to Stripe and came back to a "Something
  // not working?" prompt, on a single click, while the product worked.
  describe('dead_click_dom vs navigation', () => {
    function clickFakeButton(): HTMLDivElement {
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'Pay $20'
      document.body.appendChild(div)
      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return div
    }

    it('does not report a dead click when the page starts unloading (beforeunload)', () => {
      makeDetector()
      const div = clickFakeButton()

      vi.advanceTimersByTime(100)
      window.dispatchEvent(new Event('beforeunload'))
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(0)

      document.body.removeChild(div)
    })

    it('does not report a dead click when the page is hidden for navigation (pagehide)', () => {
      makeDetector()
      const div = clickFakeButton()

      vi.advanceTimersByTime(100)
      window.dispatchEvent(new Event('pagehide'))
      vi.advanceTimersByTime(500)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(0)

      document.body.removeChild(div)
    })

    it('does not report a dead click when an SPA history navigation follows the click', () => {
      makeDetector()
      const div = clickFakeButton()

      vi.advanceTimersByTime(100)
      history.pushState({}, '', '/checkout')
      vi.advanceTimersByTime(500)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(0)

      document.body.removeChild(div)
    })

    it('does not report a dead click after Turbo announces a slow navigation', () => {
      makeDetector()
      const div = clickFakeButton()

      document.dispatchEvent(new CustomEvent('turbo:before-visit', { detail: { url: '/slow-checkout' } }))
      vi.advanceTimersByTime(1100)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      document.body.removeChild(div)
    })

    it('does not report a dead click after Turbo starts a form submission', () => {
      makeDetector()
      const div = clickFakeButton()

      document.dispatchEvent(new CustomEvent('turbo:submit-start'))
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      document.body.removeChild(div)
    })

    it('does not report a dead click after a Turbo Frame starts fetching', () => {
      makeDetector()
      const div = clickFakeButton()

      document.dispatchEvent(new CustomEvent('turbo:before-fetch-request'))
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      document.body.removeChild(div)
    })

    it('does not report a dead click for a native link that opens a new tab', async () => {
      makeDetector()
      const link = document.createElement('a')
      link.href = '/documentation'
      link.target = '_blank'
      link.className = 'btn'
      link.textContent = 'Documentation'
      document.body.appendChild(link)

      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom')).toHaveLength(0)

      document.body.removeChild(link)
    })

    it('does not report a dead click when the navigation lands in the same tick as the click', () => {
      makeDetector()
      const div = clickFakeButton()

      window.dispatchEvent(new Event('beforeunload'))
      vi.advanceTimersByTime(500)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(0)

      document.body.removeChild(div)
    })

    // Requirement 3: a button that genuinely does nothing must still be caught.
    it('still reports a dead click when nothing mutates and nothing navigates', () => {
      makeDetector()
      const div = clickFakeButton()

      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(1)

      document.body.removeChild(div)
    })

    // Guards against acquitting every later click with a sticky boolean flag.
    it('still reports a dead click when the navigation happened before the click', () => {
      makeDetector()
      window.dispatchEvent(new Event('beforeunload'))
      vi.advanceTimersByTime(2000)

      const div = clickFakeButton()
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(1)

      document.body.removeChild(div)
    })

    it('removes the page-leave listeners on stop', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const documentAddSpy = vi.spyOn(document, 'addEventListener')
      const documentRemoveSpy = vi.spyOn(document, 'removeEventListener')

      makeDetector()
      const added = addSpy.mock.calls.filter(c => c[0] === 'beforeunload' || c[0] === 'pagehide')
      expect(added.length).toBe(2)
      const turboEvents = ['turbo:before-visit', 'turbo:submit-start', 'turbo:before-fetch-request']
      const addedTurbo = documentAddSpy.mock.calls.filter(c => turboEvents.includes(c[0]))
      expect(addedTurbo).toHaveLength(3)

      detector.stop()
      const removed = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload' || c[0] === 'pagehide')
      expect(removed.map(c => [c[0], c[1]])).toEqual(added.map(c => [c[0], c[1]]))
      const removedTurbo = documentRemoveSpy.mock.calls.filter(c => turboEvents.includes(c[0]))
      expect(removedTurbo.map(c => [c[0], c[1]])).toEqual(addedTurbo.map(c => [c[0], c[1]]))

      addSpy.mockRestore()
      removeSpy.mockRestore()
      documentAddSpy.mockRestore()
      documentRemoveSpy.mockRestore()
    })

    it('does not carry a navigation verdict into a recreated detector', () => {
      makeDetector()
      window.dispatchEvent(new Event('beforeunload'))
      detector.stop()

      makeDetector()
      const div = clickFakeButton()
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(1)

      document.body.removeChild(div)
    })
  })

  describe('cooldown persistence', () => {
    it('keeps the 60s cooldown across a recreated detector', () => {
      makeDetector()
      const div = document.createElement('div')
      div.textContent = 'static text'
      document.body.appendChild(div)
      for (let i = 0; i < 4; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(events.filter(e => e.signal === 'rage_click').length).toBe(1)

      // A Turbo visit used to reset cooldownUntil, so navigating was a way to
      // bypass the throttle entirely.
      detector.stop()
      makeDetector()

      const other = document.createElement('div')
      other.style.cursor = 'pointer'
      other.textContent = 'fake button'
      document.body.appendChild(other)
      other.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(0)

      document.body.removeChild(div)
      document.body.removeChild(other)
    })

    it('allows a new signal once the persisted cooldown has elapsed', () => {
      makeDetector()
      const div = document.createElement('div')
      div.textContent = 'static text'
      document.body.appendChild(div)
      for (let i = 0; i < 4; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      detector.stop()
      vi.advanceTimersByTime(61_000)
      makeDetector()

      const other = document.createElement('div')
      other.style.cursor = 'pointer'
      other.textContent = 'fake button'
      document.body.appendChild(other)
      other.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(1000)

      expect(events.filter(e => e.signal === 'dead_click_dom').length).toBe(1)

      document.body.removeChild(div)
      document.body.removeChild(other)
    })
  })
})
