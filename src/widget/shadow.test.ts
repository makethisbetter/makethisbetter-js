import { afterEach, describe, expect, it } from 'vitest'
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
})
