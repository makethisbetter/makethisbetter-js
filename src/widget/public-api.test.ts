import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MakeThisBetter } from '../index'

// The host page owns its own UI. These methods are what let a customer put the
// feedback entry point in their own menu — the only workable answer on a phone
// where a permanently docked tab is in the way.
describe('public API', () => {
  function shadow(): ShadowRoot {
    return document.getElementById('mtb-widget-host')!.shadowRoot!
  }

  function tab(): HTMLElement | null {
    return shadow().querySelector<HTMLElement>('.mtb-tab')
  }

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ submission_session: { id: 's1', token: 't' } }), { status: 201 }),
    )
  })

  afterEach(() => {
    MakeThisBetter.destroy()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    document.body.removeAttribute('style')
  })

  describe('entryMode', () => {
    it('renders the tab by default', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      expect(tab()).not.toBeNull()
    })

    it('applies custom text to the docked tab', () => {
      MakeThisBetter.init({ projectKey: 'acme', tabText: 'Report a problem' })

      expect(tab()!.textContent).toBe('Report a problem')
    })

    it('renders no tab in api mode', () => {
      MakeThisBetter.init({ projectKey: 'acme', entryMode: 'api' })
      expect(tab()).toBeNull()
    })

    it('applies Widget Brand Colors without requiring a launcher', () => {
      MakeThisBetter.init({
        projectKey: 'acme',
        entryMode: 'api',
        brandColors: {
          primary: '#2563eb',
          hover: '#1d4ed8',
          active: '#1e40af',
          onPrimary: '#ffffff',
        },
      })

      const host = document.getElementById('mtb-widget-host')!
      expect(tab()).toBeNull()
      expect(host.style.getPropertyValue('--mtb-brand-primary')).toBe('#2563eb')
      expect(host.style.getPropertyValue('--mtb-brand-hover')).toBe('#1d4ed8')
      expect(host.style.getPropertyValue('--mtb-brand-active')).toBe('#1e40af')
      expect(host.style.getPropertyValue('--mtb-brand-on-primary')).toBe('#ffffff')
      expect(host.style.getPropertyValue('--mtb-brand-rgb')).toBe('37, 99, 235')
      expect(host.style.getPropertyValue('--mtb-brand-on-primary-rgb')).toBe('255, 255, 255')
    })

    it('rejects an invalid brand group and keeps the default Widget colors', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({
        projectKey: 'acme',
        brandColors: {
          primary: '#fff',
          hover: '#1d4ed8',
          active: '#1e40af',
          onPrimary: '#ffffff',
        },
      })

      const host = document.getElementById('mtb-widget-host')!
      expect(host.style.getPropertyValue('--mtb-brand-primary')).toBe('')
      expect(tab()!.style.getPropertyValue('--mtb-tab-bg')).toBe('')
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('brandColors'))
    })

    it('rejects an incomplete brand group with one configuration warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({
        projectKey: 'acme',
        brandColors: {
          primary: '#2563eb',
          hover: '#1d4ed8',
          active: '#1e40af',
        } as never,
      })

      expect(document.getElementById('mtb-widget-host')!.style.getPropertyValue('--mtb-brand-primary')).toBe('')
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('brandColors'))
    })

    it('warns for a malformed runtime value instead of treating it as absent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({ projectKey: 'acme', brandColors: null as never })

      expect(document.getElementById('mtb-widget-host')!.style.getPropertyValue('--mtb-brand-primary')).toBe('')
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('brandColors'))
    })

    it('keeps the default Widget colors when no color option is configured', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({ projectKey: 'acme' })

      expect(document.getElementById('mtb-widget-host')!.style.getPropertyValue('--mtb-brand-primary')).toBe('')
      expect(tab()!.style.getPropertyValue('--mtb-tab-bg')).toBe('')
      expect(warn).not.toHaveBeenCalled()
    })

    it('applies a valid brand group without enforcing text contrast', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({
        projectKey: 'acme',
        brandColors: {
          primary: '#facc15',
          hover: '#eab308',
          active: '#ca8a04',
          onPrimary: '#ffffff',
        },
      })

      const host = document.getElementById('mtb-widget-host')!
      expect(host.style.getPropertyValue('--mtb-brand-primary')).toBe('#facc15')
      expect(host.style.getPropertyValue('--mtb-brand-on-primary')).toBe('#ffffff')
      expect(tab()!.style.getPropertyValue('--mtb-tab-bg')).toBe('')
      expect(warn).not.toHaveBeenCalled()
    })

    it('uses valid Widget Brand Colors for the docked tab', () => {
      MakeThisBetter.init({
        projectKey: 'acme',
        brandColors: {
          primary: '#2563eb',
          hover: '#1d4ed8',
          active: '#1e40af',
          onPrimary: '#ffffff',
        },
      })

      expect(document.getElementById('mtb-widget-host')!.style.getPropertyValue('--mtb-brand-primary')).toBe('#2563eb')
      expect(tab()!.style.getPropertyValue('--mtb-tab-bg')).toBe('')
    })

    // A customer who sets api mode and then never calls open() has installed a
    // widget that can never be reached, and nothing else would tell them.
    it('warns that api mode needs a trigger of its own', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({ projectKey: 'acme', entryMode: 'api' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('entryMode'))
    })

    it('does not warn in the default mode', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({ projectKey: 'acme' })
      expect(warn).not.toHaveBeenCalled()
    })

    // 'api' is a supported setting. Warning on a live site would mean a
    // third-party script shouting at customers who configured it correctly,
    // so the reminder is for the integrator's own machine only.
    it('stays quiet on a production host', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const original = window.location.hostname
      Object.defineProperty(window, 'location', {
        value: { ...window.location, hostname: 'app.customer.com' },
        configurable: true,
        writable: true,
      })

      MakeThisBetter.init({ projectKey: 'acme', entryMode: 'api' })
      expect(warn).not.toHaveBeenCalled()

      Object.defineProperty(window, 'location', {
        value: { ...window.location, hostname: original },
        configurable: true,
        writable: true,
      })
    })
  })

  describe('open / close', () => {
    it('open() starts annotation without the tab', () => {
      MakeThisBetter.init({ projectKey: 'acme', entryMode: 'api' })
      MakeThisBetter.open()
      expect(shadow().querySelector('.mtb-overlay')).not.toBeNull()
    })

    it('open() is idempotent while already annotating', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      MakeThisBetter.open()
      MakeThisBetter.open()
      expect(shadow().querySelectorAll('.mtb-overlay')).toHaveLength(1)
    })

    it('close() returns to idle and restores the page', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      MakeThisBetter.open()
      MakeThisBetter.close()

      expect(shadow().querySelector('.mtb-overlay')).toBeNull()
      expect(document.body.style.overflow).toBe('')
    })

    it('close() on an idle widget is harmless', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      expect(() => MakeThisBetter.close()).not.toThrow()
    })
  })

  describe('showLauncher / hideLauncher', () => {
    it('hideLauncher() removes the tab but keeps the widget usable', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      MakeThisBetter.hideLauncher()

      expect(tab()).toBeNull()
      MakeThisBetter.open()
      expect(shadow().querySelector('.mtb-overlay')).not.toBeNull()
    })

    it('showLauncher() brings the tab back', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      MakeThisBetter.hideLauncher()
      MakeThisBetter.showLauncher()

      expect(tab()).not.toBeNull()
    })

    it('showLauncher() can reveal the tab in api mode', () => {
      MakeThisBetter.init({ projectKey: 'acme', entryMode: 'api' })
      MakeThisBetter.showLauncher()

      expect(tab()).not.toBeNull()
    })

    it('repeated calls do not stack up tabs', () => {
      MakeThisBetter.init({ projectKey: 'acme' })
      MakeThisBetter.showLauncher()
      MakeThisBetter.showLauncher()

      expect(shadow().querySelectorAll('.mtb-tab')).toHaveLength(1)
    })
  })

  describe('configuration guards', () => {
    // Without a key the widget renders and behaves perfectly — and every
    // submit 401s. The reporter sees a generic failure, the integrator sees
    // nothing; the warning at init is the only place the mistake is visible.
    it('warns when projectKey is missing', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({} as never)

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('projectKey'))
    })

    it('warns when projectKey is empty', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      MakeThisBetter.init({ projectKey: '' })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('projectKey'))
    })

    // SSR frameworks run the same component code on the server, where there
    // is no document — init there must be a silent no-op, not a
    // ReferenceError thrown into the host's render pass.
    it('init on a server render is a no-op rather than a crash', () => {
      vi.stubGlobal('document', undefined)

      expect(() => MakeThisBetter.init({ projectKey: 'acme' })).not.toThrow()

      vi.unstubAllGlobals()
      expect(document.getElementById('mtb-widget-host')).toBeNull()
    })
  })

  describe('before init', () => {
    it('every method is a no-op rather than a crash', () => {
      expect(() => {
        MakeThisBetter.open()
        MakeThisBetter.close()
        MakeThisBetter.showLauncher()
        MakeThisBetter.hideLauncher()
      }).not.toThrow()
    })
  })
})
