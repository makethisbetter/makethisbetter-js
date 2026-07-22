import { describe, it, expect, afterEach } from 'vitest'
import { BreadcrumbCollector } from './breadcrumbs'

function clickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('BreadcrumbCollector', () => {
  let collector: BreadcrumbCollector

  afterEach(() => {
    collector?.stop()
    document.body.innerHTML = ''
  })

  it('starts empty', () => {
    collector = new BreadcrumbCollector()
    collector.start()
    expect(collector.getBreadcrumbs()).toHaveLength(0)
  })

  it('keeps only the last 20 breadcrumbs', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const button = document.createElement('button')
    document.body.appendChild(button)
    for (let i = 0; i < 25; i++) {
      clickOn(button)
    }

    expect(collector.getBreadcrumbs()).toHaveLength(20)
  })

  it('captures clicks with selector and name', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const button = document.createElement('button')
    button.id = 'save-btn'
    button.textContent = 'Save'
    document.body.appendChild(button)
    clickOn(button)

    const crumbs = collector.getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].type).toBe('ui')
    expect(crumbs[0].category).toBe('ui.click')
    expect(crumbs[0].message).toBe('Save')
    expect(crumbs[0].data?.selector).toBe('#save-btn')
  })

  it('ignores clicks inside the widget host', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const host = document.createElement('div')
    host.id = 'mtb-widget-host'
    const button = document.createElement('button')
    host.appendChild(button)
    document.body.appendChild(host)
    clickOn(button)

    expect(collector.getBreadcrumbs()).toHaveLength(0)
  })

  it('captures input changes without values', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const input = document.createElement('input')
    input.name = 'email'
    input.value = 'secret@example.com'
    document.body.appendChild(input)
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const crumbs = collector.getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].category).toBe('ui.input')
    expect(crumbs[0].data?.field).toBe('email')
    expect(JSON.stringify(crumbs[0])).not.toContain('secret@example.com')
  })

  it('captures pushState navigation with from/to URLs', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const from = location.href
    history.pushState({}, '', '/checkout')

    const crumbs = collector.getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].type).toBe('navigation')
    expect(crumbs[0].category).toBe('navigation')
    expect(crumbs[0].data?.from).toBe(from)
    expect(crumbs[0].data?.to).toBe(location.href)
    expect(crumbs[0].data?.to).toContain('/checkout')
  })

  it('captures console errors from the error source', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    window.onerror?.('TypeError: boom', 'app.js', 1, 1, undefined)

    const crumbs = collector.getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].type).toBe('console')
    expect(crumbs[0].category).toBe('console.error')
    expect(crumbs[0].message).toBe('TypeError: boom')
  })

  it('getBreadcrumbs returns a copy', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const button = document.createElement('button')
    document.body.appendChild(button)
    clickOn(button)

    const copy = collector.getBreadcrumbs()
    copy.pop()

    expect(collector.getBreadcrumbs()).toHaveLength(1)
  })

  it('stops capturing after stop()', () => {
    collector = new BreadcrumbCollector()
    collector.start()
    collector.stop()

    const button = document.createElement('button')
    document.body.appendChild(button)
    clickOn(button)
    window.onerror?.('after stop', 'app.js', 1, 1, undefined)
    history.pushState({}, '', '/after-stop')

    expect(collector.getBreadcrumbs()).toHaveLength(0)
  })

  it('keeps breadcrumbs in insertion order', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const button = document.createElement('button')
    document.body.appendChild(button)
    clickOn(button)
    history.pushState({}, '', '/ordered')
    window.onerror?.('ordered error', 'app.js', 1, 1, undefined)

    const categories = collector.getBreadcrumbs().map(c => c.category)
    expect(categories).toEqual(['ui.click', 'navigation', 'console.error'])
  })
})
