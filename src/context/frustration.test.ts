import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { FrustrationDetector, FrustrationEvent } from './frustration'

describe('FrustrationDetector', () => {
  let detector: FrustrationDetector
  let events: FrustrationEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    detector?.stop()
    vi.useRealTimers()
  })

  function makeDetector(): FrustrationDetector {
    events = []
    detector = new FrustrationDetector((e) => events.push(e))
    detector.start()
    return detector
  }

  it('detects rage clicks (3+ clicks on same element within 1s)', () => {
    makeDetector()
    const div = document.createElement('div')
    div.textContent = 'static text'
    document.body.appendChild(div)

    for (let i = 0; i < 3; i++) {
      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }

    const rageEvents = events.filter(e => e.signal === 'rage_click')
    expect(rageEvents.length).toBe(1)
    expect(rageEvents[0].target).toContain('div')

    document.body.removeChild(div)
  })

  it('does not trigger dead click from a single click (requires 3+ dead clicks AND console errors)', () => {
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

  it('rage clicks always trigger (high priority, ignores cooldown)', () => {
    makeDetector()
    const div = document.createElement('div')
    div.textContent = 'static'
    document.body.appendChild(div)

    for (let i = 0; i < 3; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(events.length).toBe(1)

    for (let i = 0; i < 3; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

  it('does not directly emit console errors (only counts them as dead-click input)', () => {
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

  describe('rapid_navigation', () => {
    it('detects 3+ navigations within 5 seconds', () => {
      makeDetector()

      history.pushState({}, '', '/page1')
      history.pushState({}, '', '/page2')
      history.pushState({}, '', '/page3')

      const navEvents = events.filter(e => e.signal === 'rapid_navigation')
      expect(navEvents.length).toBe(1)
    })

    it('does not trigger with fewer than 3 navigations', () => {
      makeDetector()

      history.pushState({}, '', '/page1')
      history.pushState({}, '', '/page2')

      const navEvents = events.filter(e => e.signal === 'rapid_navigation')
      expect(navEvents.length).toBe(0)
    })

    it('does not trigger when navigations are spread beyond 5s window', () => {
      makeDetector()

      history.pushState({}, '', '/page1')
      vi.advanceTimersByTime(3000)
      history.pushState({}, '', '/page2')
      vi.advanceTimersByTime(3000)
      history.pushState({}, '', '/page3')

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
    it('detects HTML5 constraint validation failure', () => {
      makeDetector()
      const form = document.createElement('form')
      const input = document.createElement('input')
      input.required = true
      form.appendChild(input)
      document.body.appendChild(form)

      input.dispatchEvent(new Event('invalid', { bubbles: true }))

      const formEvents = events.filter(e => e.signal === 'form_failure')
      expect(formEvents.length).toBe(1)
      expect(formEvents[0].target).toContain('form')

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

    it('only triggers once per URL (deduplication)', () => {
      const originalTitle = document.title
      document.title = '404 Not Found'
      makeDetector()

      detector.stop()
      events = []
      detector = new FrustrationDetector((e) => events.push(e))
      detector.start()

      const errorEvents = events.filter(e => e.signal === 'error_page')
      expect(errorEvents.length).toBe(1)

      document.title = originalTitle
    })
  })

  describe('dead_click_dom', () => {
    it('detects click on cursor:pointer element with no DOM mutation', () => {
      makeDetector()
      const div = document.createElement('div')
      div.style.cursor = 'pointer'
      div.textContent = 'fake button'
      document.body.appendChild(div)

      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(500)

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
      vi.advanceTimersByTime(500)

      const domEvents = events.filter(e => e.signal === 'dead_click_dom')
      expect(domEvents.length).toBe(1)

      document.body.removeChild(div)
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

      vi.advanceTimersByTime(500)
      expect(disconnectSpy).toHaveBeenCalledTimes(1)

      document.body.removeChild(div)
      observeSpy.mockRestore()
      disconnectSpy.mockRestore()
    })
  })
})
