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

  // A customer who marked a region rr-block/rr-mask marked it for the whole
  // SDK. The replay recorder already obeys those; a breadcrumb quoting 40
  // characters of the same element defeated the point.
  it.each(['rr-block', 'rr-mask'])('names a %s element structurally instead of quoting it', (cls) => {
    collector = new BreadcrumbCollector()
    collector.start()

    const button = document.createElement('button')
    button.className = cls
    button.id = 'patient-jane-doe'
    button.textContent = 'Charge $4,210.00 to •••• 4242'
    document.body.appendChild(button)
    clickOn(button)

    expect(collector.getBreadcrumbs()[0].message).toBe('button')
    expect(collector.getBreadcrumbs()[0].data?.selector).toBe('button')
  })

  it('masks a click on a descendant of a marked region', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    const region = document.createElement('div')
    region.className = 'rr-mask'
    const cell = document.createElement('span')
    cell.setAttribute('role', 'gridcell')
    cell.id = 'patient-jane-doe'
    cell.textContent = 'Jane Patient — MRN 88213'
    region.appendChild(cell)
    document.body.appendChild(region)
    clickOn(cell)

    expect(collector.getBreadcrumbs()[0].message).toBe('gridcell')
    expect(collector.getBreadcrumbs()[0].data?.selector).toBe('span')
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

  it.each(['rr-block', 'rr-mask'])('does not name a changed field inside a %s region from its content', (cls) => {
    collector = new BreadcrumbCollector()
    collector.start()

    const region = document.createElement('div')
    region.className = cls
    const input = document.createElement('input')
    input.name = 'card_number_4242'
    input.placeholder = 'Card 4242 4242 4242 4242'
    region.appendChild(input)
    document.body.appendChild(region)
    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(collector.getBreadcrumbs()[0].message).toBe('input')
    expect(collector.getBreadcrumbs()[0].data?.field).toBe('input')
  })

  it('captures navigation without query or fragment values', () => {
    history.replaceState({}, '', '/cart?token=secret#review')
    collector = new BreadcrumbCollector()
    collector.start()

    history.pushState({}, '', '/checkout?payment=4242#confirm')

    const crumbs = collector.getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].type).toBe('navigation')
    expect(crumbs[0].category).toBe('navigation')
    expect(crumbs[0].data?.from).toBe(`${location.origin}/cart`)
    expect(crumbs[0].data?.to).toBe(`${location.origin}/checkout`)
    expect(JSON.stringify(crumbs[0])).not.toContain('secret')
    expect(JSON.stringify(crumbs[0])).not.toContain('4242')
  })

  it('captures console errors from the error source', () => {
    collector = new BreadcrumbCollector()
    collector.start()

    window.onerror?.(
      'TypeError: token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfMTIzIn0.dGVzdC1zaWduYXR1cmU',
      'https://app.example.com/assets/app.js?token=secret',
      1,
      1,
      new TypeError('sensitive'),
    )

    const crumbs = collector.getBreadcrumbs()
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].type).toBe('console')
    expect(crumbs[0].category).toBe('console.error')
    expect(crumbs[0].message).toBe('TypeError (/assets/app.js:1:1)')
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
