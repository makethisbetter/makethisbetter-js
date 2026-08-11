import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { AnnotationToolbar } from './toolbar'
import { getMessages } from '../i18n'
import cssText from '../styles/widget.css?inline'

function moveMouseTo(x: number, y: number) {
  document.dispatchEvent(
    new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }),
  )
}

function tapAt(x: number, y: number) {
  document.dispatchEvent(
    new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'touch', bubbles: true }),
  )
}

function setPointerCoarse(coarse: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
  })) as unknown as typeof window.matchMedia
}

describe('AnnotationToolbar', () => {
  let shadow: ShadowContainer
  let toolbar: AnnotationToolbar
  const messages = getMessages('en')

  function setup(opts?: { onModeChange?: (mode: 'markup' | 'record') => void; showTouchHint?: boolean }) {
    shadow = new ShadowContainer()
    toolbar = new AnnotationToolbar(shadow, messages, vi.fn(), opts?.onModeChange, 'right', opts?.showTouchHint)
    // The hint bar is what the dimming measures; jsdom gives every element a
    // zero rect, so without this nothing is ever "under the pointer".
    vi.spyOn(toolbar['hintBarEl'], 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 300,
      top: 10,
      bottom: 60,
      width: 200,
      height: 50,
      x: 100,
      y: 10,
      toJSON: () => {},
    } as DOMRect)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setPointerCoarse(false)
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('creates a toolbar element in the shadow root', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-toolbar')).toBeInstanceOf(HTMLDivElement)
      toolbar.destroy()
    })

    it('renders markup and record buttons', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-toolbar-mode-markup')).toBeInstanceOf(HTMLButtonElement)
      expect(shadow.root.querySelector('.mtb-toolbar-mode-record')).toBeInstanceOf(HTMLButtonElement)
      toolbar.destroy()
    })

    it('renders the hint text', () => {
      setup()
      const hint = shadow.root.querySelector('.mtb-toolbar-hint')
      expect(hint!.textContent).toBe(messages.toolbar.hint)
      toolbar.destroy()
    })

    it('renders an exit button', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-exit-btn')).toBeInstanceOf(HTMLButtonElement)
      toolbar.destroy()
    })

    it('renders locale messages as text', () => {
      shadow = new ShadowContainer()
      const hostileMessages = structuredClone(messages)
      const payload = '<img src=x onerror="window.widgetXss=true">'
      hostileMessages.toolbar.markup = payload
      hostileMessages.toolbar.record = payload
      hostileMessages.toolbar.exit = payload
      hostileMessages.toolbar.hint = payload
      toolbar = new AnnotationToolbar(shadow, hostileMessages, vi.fn())

      expect(shadow.root.querySelector('img')).toBeNull()
      expect(shadow.root.querySelector('.mtb-toolbar-hint')?.textContent).toBe(payload)
      expect(shadow.root.querySelector('.mtb-toolbar-mode-markup')?.textContent?.trim()).toBe(payload)
      toolbar.destroy()
    })

    it('starts in markup mode with markup button active', () => {
      setup()
      expect(toolbar.getMode()).toBe('markup')
      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      expect(markupBtn.classList.contains('active')).toBe(true)
      toolbar.destroy()
    })
  })

  describe('setMode', () => {
    it('switches to record mode and updates active class', () => {
      setup()
      toolbar.setMode('record')
      expect(toolbar.getMode()).toBe('record')

      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      const recordBtn = shadow.root.querySelector('.mtb-toolbar-mode-record')!
      expect(markupBtn.classList.contains('active')).toBe(false)
      expect(recordBtn.classList.contains('active')).toBe(true)

      const hint = shadow.root.querySelector('.mtb-toolbar-hint')!
      expect(hint.textContent).toBe(messages.toolbar.hintRecord)
      toolbar.destroy()
    })

    it('switches back to markup mode', () => {
      setup()
      toolbar.setMode('record')
      toolbar.setMode('markup')
      expect(toolbar.getMode()).toBe('markup')

      const hint = shadow.root.querySelector('.mtb-toolbar-hint')!
      expect(hint.textContent).toBe(messages.toolbar.hint)
      toolbar.destroy()
    })
  })

  describe('button clicks', () => {
    it('calls onModeChange when markup button is clicked', () => {
      const onModeChange = vi.fn()
      setup({ onModeChange })
      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      markupBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onModeChange).toHaveBeenCalledWith('markup')
      toolbar.destroy()
    })

    it('calls onModeChange when record button is clicked', () => {
      const onModeChange = vi.fn()
      setup({ onModeChange })
      const recordBtn = shadow.root.querySelector('.mtb-toolbar-mode-record')!
      recordBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onModeChange).toHaveBeenCalledWith('record')
      toolbar.destroy()
    })

    it('calls onExit when exit button is clicked', () => {
      shadow = new ShadowContainer()
      const onExit = vi.fn()
      toolbar = new AnnotationToolbar(shadow, messages, onExit)

      const exitBtn = shadow.root.querySelector('.mtb-exit-btn')!
      exitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onExit).toHaveBeenCalledOnce()
      toolbar.destroy()
    })

    it('works without onModeChange callback', () => {
      setup()
      const recordBtn = shadow.root.querySelector('.mtb-toolbar-mode-record')!
      expect(() => {
        recordBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }).not.toThrow()
      expect(toolbar.getMode()).toBe('record')
      toolbar.destroy()
    })
  })

  describe('destroy', () => {
    it('removes the toolbar element from the shadow root', () => {
      setup()
      toolbar.destroy()
      expect(shadow.root.querySelector('.mtb-toolbar')).toBeNull()
    })
  })

  describe('the hint bar', () => {
    const hintBar = () => shadow.root.querySelector('.mtb-hint-bar')!
    const isDimmed = () => hintBar().classList.contains('mtb-hint-bar--under-pointer')

    // A fixed-position element is laid out against its nearest transformed
    // ancestor. The toolbar is transformed at rest and again by its entry
    // animation, so a hint nested inside it could never sit centred on the page.
    it('is a sibling of the toolbar, not a descendant of it', () => {
      setup()
      expect(hintBar().parentNode).toBe(shadow.root)
      expect(toolbar['el'].querySelector('.mtb-hint-bar')).toBeNull()
      toolbar.destroy()
    })

    it('carries the hint text and follows the mode', () => {
      setup()
      expect(hintBar().textContent).toContain(messages.toolbar.hint)
      toolbar.setMode('record')
      expect(hintBar().textContent).toContain(messages.toolbar.hintRecord)
      toolbar.destroy()
    })

    it('steps back only while the pointer is on top of it', () => {
      setup()
      expect(isDimmed()).toBe(false)

      moveMouseTo(150, 30)
      expect(isDimmed()).toBe(true)

      moveMouseTo(1000, 1000)
      expect(isDimmed()).toBe(false)
      toolbar.destroy()
    })

    // The old behaviour dimmed on any movement anywhere and restored on a
    // timer, which left the bar dim for as long as the pointer rested
    // elsewhere on the page.
    it('ignores movement that is not over it, however long it lasts', () => {
      setup()
      moveMouseTo(1000, 1000)
      vi.advanceTimersByTime(5000)
      moveMouseTo(900, 900)
      expect(isDimmed()).toBe(false)
      toolbar.destroy()
    })

    it('never takes a click, so the page under it stays reachable', () => {
      const start = cssText.indexOf('.mtb-hint-bar {')
      expect(start).toBeGreaterThan(-1)
      const rule = cssText.slice(start, cssText.indexOf('}', start))

      expect(rule).toContain('pointer-events: none')
      // Appended before the dim and overlay layers, so without this it renders
      // underneath them and the annotation dim washes it out.
      expect(rule).toContain('z-index: 2147483647')
    })

    it('never fades for a touch pointer', () => {
      setup()
      tapAt(150, 30)
      expect(isDimmed()).toBe(false)
      toolbar.destroy()
    })

    it('shows a static text-only coach mark on the first touch entry', () => {
      setPointerCoarse(true)
      setup()

      expect(hintBar().textContent).toBe(messages.toolbar.hintTouch)
      expect(hintBar().querySelector('svg')).toBeNull()
      expect(hintBar().classList.contains('mtb-hint-bar--dismissed')).toBe(false)

      const mobile = cssText.slice(cssText.indexOf('@media (max-width: 480px)'))
      const start = mobile.indexOf('.mtb-hint-bar {')
      const rule = mobile.slice(start, mobile.indexOf('\n  }', start))
      expect(rule).toContain('background: rgba(0, 0, 0, 0.1)')
      expect(rule).toContain('animation: none')
      expect(rule).toContain('transition: none')
      toolbar.destroy()
    })

    it('dismisses on the first touch without consuming it', () => {
      setPointerCoarse(true)
      setup()
      const firstTouch = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })

      document.dispatchEvent(firstTouch)

      expect(hintBar().classList.contains('mtb-hint-bar--dismissed')).toBe(true)
      expect(firstTouch.defaultPrevented).toBe(false)
      toolbar.destroy()
    })

    it('starts hidden after the one-time touch hint has already been shown', () => {
      setPointerCoarse(true)
      setup({ showTouchHint: false })

      expect(hintBar().classList.contains('mtb-hint-bar--dismissed')).toBe(true)
      toolbar.destroy()
    })
  })

  describe('making room for itself', () => {
    // Keyed to the bar being mounted, never to the tab's active state: the tab
    // is still active while a clarification card is open, and the bar is gone
    // by then — hiding it there would leave no way out at all.
    it('marks the host while it is up and unmarks it on destroy', () => {
      setup()
      expect(shadow.host.hasAttribute('data-mtb-toolbar')).toBe(true)

      toolbar.destroy()
      expect(shadow.host.hasAttribute('data-mtb-toolbar')).toBe(false)
    })

    it('takes the hint bar down with it', () => {
      setup()
      toolbar.destroy()
      expect(shadow.root.querySelector('.mtb-hint-bar')).toBeNull()
      expect(shadow.root.querySelector('.mtb-toolbar')).toBeNull()
    })

    it('falls back to the compact mobile bar height before layout', () => {
      setup()
      expect(toolbar.height()).toBe(44)
      toolbar.destroy()
    })

    it('keeps compact phone chrome with a 44px touch target', () => {
      const mobile = cssText.slice(cssText.indexOf('@media (max-width: 480px)'))
      const toolbarStart = mobile.indexOf('.mtb-toolbar {')
      const toolbarRule = mobile.slice(toolbarStart, mobile.indexOf('\n  }', toolbarStart))
      expect(toolbarRule).toContain('height: calc(44px + env(safe-area-inset-top, 0px))')
      expect(toolbarRule).toContain('min-height: calc(44px + env(safe-area-inset-top, 0px))')
      expect(toolbarRule).toContain('background: rgba(248, 248, 248, 0.96)')

      const modesStart = mobile.indexOf('.mtb-toolbar-modes {')
      const modesRule = mobile.slice(modesStart, mobile.indexOf('\n  }', modesStart))
      expect(modesRule).toContain('padding: 2px')
      expect(modesRule).toContain('background: rgba(118, 118, 128, 0.12)')

      const buttonsStart = mobile.indexOf('.mtb-toolbar-mode-btn,')
      const buttonsRule = mobile.slice(buttonsStart, mobile.indexOf('\n  }', buttonsStart))
      expect(buttonsRule).toContain('height: 32px')
      expect(buttonsRule).toContain('min-height: 32px')

      const hitAreaStart = mobile.indexOf('.mtb-toolbar-mode-btn::after,')
      const hitAreaRule = mobile.slice(hitAreaStart, mobile.indexOf('\n  }', hitAreaStart))
      expect(hitAreaRule).toContain('inset: -6px 0')

      const exitStart = mobile.indexOf('.mtb-exit-btn {', hitAreaStart)
      const exitRule = mobile.slice(exitStart, mobile.indexOf('\n  }', exitStart))
      expect(exitRule).toContain('width: 32px')
      expect(exitRule).toContain('border-radius: 50%')

      const exitLabelStart = mobile.indexOf('.mtb-exit-btn .mtb-toolbar-label {')
      const exitLabelRule = mobile.slice(exitLabelStart, mobile.indexOf('\n  }', exitLabelStart))
      expect(exitLabelRule).toContain('display: none')

      const hintStart = mobile.indexOf('.mtb-hint-bar {')
      const hintRule = mobile.slice(hintStart, mobile.indexOf('\n  }', hintStart))
      expect(hintRule).toContain('top: calc(44px + env(safe-area-inset-top, 0px))')
    })

    // Rotated labels were tried and read badly: at 40px wide the words clip and
    // stack into an unreadable column. The name still has to reach anyone who
    // cannot see the icon.
    it('shows icons only, but still names every control', () => {
      setup()
      for (const sel of ['.mtb-toolbar-mode-markup', '.mtb-toolbar-mode-record', '.mtb-exit-btn']) {
        const btn = shadow.root.querySelector(sel)!
        expect(btn.getAttribute('aria-label')).toBeTruthy()
        expect(btn.getAttribute('title')).toBe(btn.getAttribute('aria-label'))
        expect(btn.querySelector('svg')).not.toBeNull()
      }
      expect(shadow.root.querySelector('.mtb-exit-btn svg')!.getAttribute('stroke')).toBe('currentColor')

      const start = cssText.indexOf('.mtb-toolbar-label {')
      expect(start).toBeGreaterThan(-1)
      expect(cssText.slice(start, cssText.indexOf('}', start))).toContain('display: none')
      toolbar.destroy()
    })

    it('stacks its controls rather than laying them out in a row', () => {
      const start = cssText.indexOf('.mtb-toolbar-modes {\n  flex-direction: column')
      expect(start).toBeGreaterThan(-1)
    })

    // The tab honours a left-configured widget; a bar pinned right would put the
    // two halves of the widget on opposite sides of the page.
    it('stands at the edge the widget is configured for', () => {
      shadow = new ShadowContainer()
      toolbar = new AnnotationToolbar(shadow, messages, vi.fn(), undefined, 'left')
      expect(shadow.root.querySelector('.mtb-toolbar')!.classList.contains('left')).toBe(true)
      toolbar.destroy()

      shadow = new ShadowContainer()
      toolbar = new AnnotationToolbar(shadow, messages, vi.fn(), undefined, 'right')
      expect(shadow.root.querySelector('.mtb-toolbar')!.classList.contains('left')).toBe(false)
      toolbar.destroy()
    })

    // Keyframes that encode one element's resting transform cannot be shared.
    // This bar rests at translateY(-50%); the record and draw bars rest at
    // translateX(-50%). Handing them this bar's keyframes threw both upward for
    // the length of the animation and dropped them back when it ended.
    it('animates in on keyframes of its own', () => {
      const barStart = cssText.indexOf('.mtb-toolbar {')
      expect(cssText.slice(barStart, cssText.indexOf('}', barStart))).toContain('mtbEdgeBarIn')

      const shared = cssText.indexOf('@keyframes mtbBarIn {')
      expect(shared).toBeGreaterThan(-1)
      expect(cssText.slice(shared, cssText.indexOf('}', cssText.indexOf('to', shared)))).toContain('-50%, 0')
    })

    it('stops listening on destroy', () => {
      setup()
      toolbar.destroy()
      moveMouseTo(150, 30)
      expect(shadow.root.querySelector('.mtb-hint-bar')).toBeNull()
    })
  })

  describe('exiting', () => {
    it('answers a click on Exit', () => {
      const onExit = vi.fn()
      shadow = new ShadowContainer()
      toolbar = new AnnotationToolbar(shadow, messages, onExit)

      shadow.root.querySelector('.mtb-exit-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onExit).toHaveBeenCalledTimes(1)
      toolbar.destroy()
    })

    // Only the controls take clicks; the chrome around them lets a press reach
    // the page beneath, which is the whole point of moving to the edge.
    it('takes clicks on its controls but not on its chrome', () => {
      const barStart = cssText.indexOf('.mtb-toolbar {')
      expect(cssText.slice(barStart, cssText.indexOf('}', barStart))).toContain('pointer-events: none')

      const btnStart = cssText.indexOf('.mtb-toolbar-mode-btn,')
      expect(cssText.slice(btnStart, cssText.indexOf('}', btnStart))).toContain('pointer-events: auto')
    })
  })
})
