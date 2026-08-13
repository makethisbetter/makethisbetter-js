import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShadowContainer } from './shadow'

describe('ShadowContainer', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts widget styles inside a shadow root', () => {
    const shadow = new ShadowContainer()

    expect(document.getElementById('mtb-widget-host')?.shadowRoot).toBe(shadow.root)
    expect(shadow.root.querySelector('style')).toBeInstanceOf(HTMLStyleElement)

    shadow.destroy()
  })

  it('stores configured theme on the host', () => {
    const shadow = new ShadowContainer('dark')

    expect(document.getElementById('mtb-widget-host')?.getAttribute('data-mtb-theme')).toBe('dark')

    shadow.destroy()
  })

  it.each([
    'pointerdown',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
    'touchcancel',
    'click',
  ])(
    'keeps %s inside the widget so host dismiss handlers do not run',
    (eventType) => {
      const shadow = new ShadowContainer()
      const button = shadow.el('button')
      const widgetHandler = vi.fn()
      const hostHandler = vi.fn()
      button.addEventListener(eventType, widgetHandler)
      document.addEventListener(eventType, hostHandler)
      shadow.append(button)

      button.dispatchEvent(new Event(eventType, { bubbles: true, composed: true }))

      expect(widgetHandler).toHaveBeenCalledOnce()
      expect(hostHandler).not.toHaveBeenCalled()
      document.removeEventListener(eventType, hostHandler)
      shadow.destroy()
    },
  )

  it('keeps a complete touch tap inside the widget without swallowing its click', () => {
    const shadow = new ShadowContainer()
    const button = shadow.el('button')
    const widgetClickHandler = vi.fn()
    const hostHandler = vi.fn()
    const tapEvents = ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'click']
    button.addEventListener('click', widgetClickHandler)
    for (const eventType of tapEvents) document.addEventListener(eventType, hostHandler)
    shadow.append(button)

    button.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      pointerType: 'touch',
    }))
    button.dispatchEvent(new Event('touchstart', { bubbles: true, composed: true }))
    button.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      composed: true,
      pointerType: 'touch',
    }))
    button.dispatchEvent(new Event('touchend', { bubbles: true, composed: true }))
    button.click()

    expect(widgetClickHandler).toHaveBeenCalledOnce()
    expect(hostHandler).not.toHaveBeenCalled()
    for (const eventType of tapEvents) document.removeEventListener(eventType, hostHandler)
    shadow.destroy()
  })

  it('lets pointer movement reach document for widget dragging', () => {
    const shadow = new ShadowContainer()
    const handle = shadow.el('button')
    const documentMoveHandler = vi.fn()
    document.addEventListener('pointermove', documentMoveHandler)
    shadow.append(handle)

    handle.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      pointerType: 'touch',
    }))

    expect(documentMoveHandler).toHaveBeenCalledOnce()
    document.removeEventListener('pointermove', documentMoveHandler)
    shadow.destroy()
  })

  it('destroy removes the host element', () => {
    const shadow = new ShadowContainer()
    expect(document.getElementById('mtb-widget-host')).not.toBeNull()

    shadow.destroy()

    expect(document.getElementById('mtb-widget-host')).toBeNull()
  })

  it('destroy does not throw when the host was already detached', () => {
    // Turbo swaps document.body on navigation, detaching the host. destroy()
    // must not throw (the old removeChild(host) raised NotFoundError, aborting
    // re-init and leaving the widget missing until a hard refresh).
    const shadow = new ShadowContainer()
    document.body.innerHTML = '' // simulate Turbo replacing the body

    expect(() => shadow.destroy()).not.toThrow()
  })

  describe('a host the page supplies', () => {
    // Turbo replaces <body> on every visit, taking any script-appended element
    // with it. A page that renders the host itself can mark it
    // data-turbo-permanent, and Turbo then moves that node — shadow root and
    // all — into the new body, so a recording in progress survives a link click.
    it('mounts on an existing host instead of adding another', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      document.body.appendChild(provided)

      const shadow = new ShadowContainer()

      expect(shadow.host).toBe(provided)
      expect(document.querySelectorAll('#mtb-widget-host').length).toBe(1)

      shadow.destroy()
    })

    it('leaves a supplied host standing on destroy', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      document.body.appendChild(provided)

      const shadow = new ShadowContainer()
      shadow.destroy()

      // Removing it would break the id pairing Turbo relies on, and the next
      // boot would silently fall back to creating its own.
      expect(document.getElementById('mtb-widget-host')).toBe(provided)
      expect(provided.shadowRoot!.querySelector('style')).toBeNull()
    })

    it('restores supplied host brand properties exactly on destroy', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      provided.style.setProperty('--mtb-brand-primary', '#123456', 'important')
      document.body.appendChild(provided)

      const shadow = new ShadowContainer('auto', {
        primary: '#2563eb',
        hover: '#1d4ed8',
        active: '#1e40af',
        onPrimary: '#ffffff',
      })
      expect(provided.style.getPropertyValue('--mtb-brand-primary')).toBe('#2563eb')
      expect(provided.style.getPropertyValue('--mtb-brand-hover')).toBe('#1d4ed8')

      shadow.destroy()

      expect(provided.style.getPropertyValue('--mtb-brand-primary')).toBe('#123456')
      expect(provided.style.getPropertyValue('--mtb-brand-hover')).toBe('')
    })

    // The constructor overwrites the whole inline style with the widget's
    // fixed positioning, so only the exact original attribute string can put
    // the customer's element back the way their markup rendered it.
    it('restores a supplied host inline style and theme attribute exactly on destroy', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      provided.setAttribute('style', 'display:none;pointer-events:none')
      provided.setAttribute('data-mtb-theme', 'light')
      provided.setAttribute('data-turbo-permanent', '')
      document.body.appendChild(provided)

      const shadow = new ShadowContainer('dark')
      expect(provided.getAttribute('data-mtb-theme')).toBe('dark')
      expect(provided.style.position).toBe('fixed')

      shadow.destroy()

      expect(provided.getAttribute('style')).toBe('display:none;pointer-events:none')
      expect(provided.getAttribute('data-mtb-theme')).toBe('light')
      expect(provided.hasAttribute('data-turbo-permanent')).toBe(true)
    })

    // A leftover inline declaration — even an empty style="" from restoring
    // '' — outlives the widget for the rest of an SPA visit, so a host that
    // arrived without the attributes must end without them.
    it('leaves no style or theme attribute behind when the host had none', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      document.body.appendChild(provided)

      const shadow = new ShadowContainer('dark', {
        primary: '#2563eb',
        hover: '#1d4ed8',
        active: '#1e40af',
        onPrimary: '#ffffff',
      })
      expect(provided.style.getPropertyValue('--mtb-brand-primary')).toBe('#2563eb')

      shadow.destroy()

      expect(provided.hasAttribute('style')).toBe(false)
      expect(provided.hasAttribute('data-mtb-theme')).toBe(false)
    })

    it('leaves a supplied host untouched when it cannot take a shadow root', () => {
      const provided = document.createElement('a')
      provided.id = 'mtb-widget-host'
      provided.setAttribute('style', 'color:red')
      document.body.appendChild(provided)

      expect(() => new ShadowContainer('dark')).toThrow()

      expect(provided.getAttribute('style')).toBe('color:red')
      expect(provided.hasAttribute('data-mtb-theme')).toBe(false)
    })

    it('removes host interaction isolation when a supplied host is destroyed', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      document.body.appendChild(provided)
      const shadow = new ShadowContainer()
      const hostHandler = vi.fn()
      document.addEventListener('click', hostHandler)

      shadow.destroy()
      const button = document.createElement('button')
      provided.shadowRoot!.appendChild(button)
      button.click()

      expect(hostHandler).toHaveBeenCalledOnce()
      document.removeEventListener('click', hostHandler)
    })

    it('still removes a host it created itself', () => {
      const shadow = new ShadowContainer()
      expect(document.getElementById('mtb-widget-host')).not.toBeNull()

      shadow.destroy()
      expect(document.getElementById('mtb-widget-host')).toBeNull()
    })

    it('starts clean when it remounts on the same host', () => {
      const provided = document.createElement('div')
      provided.id = 'mtb-widget-host'
      document.body.appendChild(provided)

      const first = new ShadowContainer()
      first.append(first.el('div', 'mtb-leftover'))
      first.destroy()

      const second = new ShadowContainer()
      expect(second.root.querySelector('.mtb-leftover')).toBeNull()
      expect(second.root.querySelector('style')).not.toBeNull()

      second.destroy()
    })
  })
})
