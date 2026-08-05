import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentPopup } from './comment'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'

function setupPopup() {
  const shadow = new ShadowContainer()
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  const popup = new CommentPopup(shadow, {
    targetName: 'Export PDF',
    x: 100,
    y: 120,
    messages: getMessages('en'),
    onSubmit,
    onClose,
  })

  return { shadow, popup, onSubmit, onClose }
}

describe('CommentPopup screenshot consent', () => {
  it('offers the choice, pre-checked, when the surface allows one', () => {
    const shadow = new ShadowContainer()
    const onScreenshotToggle = vi.fn()
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: 100,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      onScreenshotToggle,
    })

    const box = shadow.root.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)

    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(onScreenshotToggle).toHaveBeenCalledWith(false)

    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(onScreenshotToggle).toHaveBeenLastCalledWith(true)

    popup.destroy()
    shadow.destroy()
  })

  // The popup is remounted mid-session — record mode returns through it — so a
  // hardcoded tick would tell the reporter a screenshot is attached after they
  // already turned it off. The box has to render the state it was handed.
  it('renders the consent it was given rather than a hardcoded tick', () => {
    const shadow = new ShadowContainer()
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: 100,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      onScreenshotToggle: vi.fn(),
      screenshotEnabled: false,
    })

    expect(shadow.root.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!.checked).toBe(false)

    popup.destroy()
    shadow.destroy()
  })

  // The drawing surfaces bake strokes onto the screenshot, so there is nothing
  // to decide — but the reporter still has to be told it is going out. The row
  // stays; only its interactivity goes.
  it('discloses without offering a choice when the surface has none', () => {
    const { shadow, popup } = setupPopup()

    const row = shadow.root.querySelector('.mtb-screenshot-opt')!
    const box = row.querySelector<HTMLInputElement>('input')!
    expect(row.classList.contains('mtb-screenshot-opt--locked')).toBe(true)
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)

    popup.destroy()
    shadow.destroy()
  })

  it('discloses the recording alone, locked, when the note follows one', () => {
    const shadow = new ShadowContainer()
    const popup = new CommentPopup(shadow, {
      targetName: 'Recording',
      x: 100,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      recordingSeconds: 12.4,
    })

    const rows = shadow.root.querySelectorAll('.mtb-screenshot-opt')
    expect(rows.length).toBe(1)
    const row = rows[0]!
    expect(row.classList.contains('mtb-screenshot-opt--locked')).toBe(true)
    expect(row.textContent).toContain('Recording (12s)')
    const box = row.querySelector<HTMLInputElement>('input')!
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)

    popup.destroy()
    shadow.destroy()
  })

  it('renders the consent copy as text, never as markup', () => {
    const shadow = new ShadowContainer()
    const messages = structuredClone(getMessages('en'))
    const payload = '<img src=x onerror="window.widgetXss=true">'
    messages.popup.screenshot_label = payload
    messages.popup.screenshot_hint = payload
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: 100,
      y: 120,
      messages,
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      onScreenshotToggle: vi.fn(),
    })

    expect(shadow.root.querySelector('.mtb-screenshot-opt span')?.textContent).toBe(payload)
    expect(shadow.root.querySelector('.mtb-screenshot-opt img')).toBeNull()

    popup.destroy()
    shadow.destroy()
  })
})

describe('CommentPopup', () => {
  it('renders visible submit and cancel actions', () => {
    const { shadow, popup } = setupPopup()

    expect(shadow.root.querySelector('.mtb-submit-btn')?.textContent).toBe('Submit')
    expect(shadow.root.querySelector('.mtb-cancel-btn')?.textContent).toBe('Cancel')

    popup.destroy()
    shadow.destroy()
  })

  it('renders target and locale messages as text', () => {
    const shadow = new ShadowContainer()
    const messages = structuredClone(getMessages('en'))
    const payload = '<img src=x onerror="window.widgetXss=true">'
    messages.popup.about = payload
    messages.popup.my_feedback = payload
    messages.popup.quickOptions[0].emoji = payload
    const popup = new CommentPopup(shadow, {
      targetName: payload,
      x: 100,
      y: 120,
      messages,
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      onMyFeedback: vi.fn(),
    })

    expect(shadow.root.querySelector('img')).toBeNull()
    expect(shadow.root.querySelector('.mtb-popup-title')?.textContent).toContain(payload)
    expect(shadow.root.querySelector('.mtb-quick-option-emoji')?.textContent).toBe(payload)

    popup.destroy()
    shadow.destroy()
  })

  it('enables submit after entering a description', () => {
    const { shadow, popup } = setupPopup()
    const textarea = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    const submit = shadow.root.querySelector<HTMLButtonElement>('.mtb-submit-btn')!

    textarea.value = 'Export does not work'
    textarea.dispatchEvent(new Event('input'))

    expect(submit.disabled).toBe(false)
    expect(submit.classList.contains('ready')).toBe(true)

    popup.destroy()
    shadow.destroy()
  })

  it('submits trimmed description', () => {
    const { shadow, popup, onSubmit } = setupPopup()
    const textarea = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    const submit = shadow.root.querySelector<HTMLButtonElement>('.mtb-submit-btn')!

    textarea.value = '  Export does not work  '
    textarea.dispatchEvent(new Event('input'))
    submit.click()

    expect(onSubmit).toHaveBeenCalledWith('Export does not work')

    popup.destroy()
    shadow.destroy()
  })

  it('submits a quick option immediately when the textarea is empty', () => {
    const { shadow, popup, onSubmit } = setupPopup()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-quick-option')!.click()

    expect(onSubmit).toHaveBeenCalledWith("Something's broken")

    popup.destroy()
    shadow.destroy()
  })

  it('preserves typed text and marks the option selected instead of auto-submitting', () => {
    const { shadow, popup, onSubmit } = setupPopup()
    const textarea = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    const quickOption = shadow.root.querySelector<HTMLButtonElement>('.mtb-quick-option')!

    textarea.value = 'Export does not work'
    textarea.dispatchEvent(new Event('input'))
    quickOption.click()

    expect(textarea.value).toBe('Export does not work')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(quickOption.classList.contains('selected')).toBe(true)

    popup.destroy()
    shadow.destroy()
  })

  it('prepends the selected quick option type to the description on submit', () => {
    const { shadow, popup, onSubmit } = setupPopup()
    const textarea = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    const submit = shadow.root.querySelector<HTMLButtonElement>('.mtb-submit-btn')!
    const quickOption = shadow.root.querySelector<HTMLButtonElement>('.mtb-quick-option')!

    textarea.value = 'Export does not work'
    textarea.dispatchEvent(new Event('input'))
    quickOption.click()
    submit.click()

    expect(onSubmit).toHaveBeenCalledWith("[Something's broken] Export does not work")

    popup.destroy()
    shadow.destroy()
  })

  it('renders the three quick options from the widget design', () => {
    const { shadow, popup } = setupPopup()

    const labels = Array.from(shadow.root.querySelectorAll<HTMLElement>('.mtb-quick-option'))
      .map(option => `${option.querySelector('.mtb-quick-option-emoji')?.textContent}${option.dataset['quick']}`)

    expect(labels).toEqual([
      "🐛Something's broken",
      '💡I have a suggestion',
      "🤔I'm confused",
    ])

    popup.destroy()
    shadow.destroy()
  })

  it('submits with Enter and preserves Shift+Enter for a new line', () => {
    const { shadow, popup, onSubmit } = setupPopup()
    const textarea = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export does not work'
    textarea.dispatchEvent(new Event('input'))

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))
    expect(onSubmit).not.toHaveBeenCalled()

    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    textarea.dispatchEvent(enter)
    expect(onSubmit).toHaveBeenCalledWith('Export does not work', enter)

    popup.destroy()
    shadow.destroy()
  })

  it('calls close from cancel', () => {
    const { shadow, popup, onClose } = setupPopup()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-cancel-btn')!.click()

    expect(onClose).toHaveBeenCalled()

    popup.destroy()
    shadow.destroy()
  })




  it('limits the popup height to the remaining viewport', () => {
    const { shadow, popup } = setupPopup()
    const element = shadow.root.querySelector<HTMLElement>('.mtb-popup')!
    const top = Number.parseFloat(element.style.top)

    expect(element.style.maxHeight).toBe(`${window.innerHeight - top - 12}px`)

    popup.destroy()
    shadow.destroy()
  })

  it('leaves room for the right-side feedback tab', () => {
    const shadow = new ShadowContainer()
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: window.innerWidth,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      position: 'right',
    })
    const element = shadow.root.querySelector<HTMLElement>('.mtb-popup')!

    expect(Number.parseFloat(element.style.left) + 320).toBeLessThanOrEqual(window.innerWidth - 44)

    popup.destroy()
    shadow.destroy()
  })

  it('leaves room for the left-side feedback tab', () => {
    const shadow = new ShadowContainer()
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: 0,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
      position: 'left',
    })
    const element = shadow.root.querySelector<HTMLElement>('.mtb-popup')!

    expect(Number.parseFloat(element.style.left)).toBeGreaterThanOrEqual(44)

    popup.destroy()
    shadow.destroy()
  })

  describe('sheet mode on narrow viewports', () => {
    function narrow(width: number) {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
    }

    function fakeViewport(height: number, offsetTop = 0) {
      const listeners: Record<string, Array<() => void>> = {}
      const vp = {
        height,
        offsetTop,
        addEventListener: (t: string, fn: () => void) => { (listeners[t] ??= []).push(fn) },
        removeEventListener: (t: string, fn: () => void) => {
          listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn)
        },
        fire: (t: string) => { for (const fn of listeners[t] ?? []) fn() },
      }
      Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true, writable: true })
      return vp
    }

    function openSheet() {
      const shadow = new ShadowContainer()
      const popup = new CommentPopup(shadow, {
        targetName: 'Export PDF',
        x: 100,
        y: 600,
        messages: getMessages('en'),
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      })
      return { shadow, popup, element: shadow.root.querySelector<HTMLElement>('.mtb-popup')! }
    }

    beforeEach(() => { vi.useFakeTimers() })

    afterEach(() => {
      vi.useRealTimers()
      narrow(1024)
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })
    })

    // The stylesheet turns the popup into a bottom sheet below 480px. Inline
    // coordinates would win over the media query and pull it back into a
    // floating card, so the JS has to stay out of the way entirely.
    it('writes no inline geometry, leaving the sheet layout to CSS', () => {
      narrow(393)
      const { shadow, popup, element } = openSheet()

      expect(element.style.left).toBe('')
      expect(element.style.top).toBe('')
      expect(element.style.maxHeight).toBe('')

      popup.destroy()
      shadow.destroy()
    })

    it('lifts the sheet above the software keyboard', () => {
      narrow(393)
      Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true, writable: true })
      const vp = fakeViewport(852)

      const { shadow, popup, element } = openSheet()
      expect(element.style.bottom).toBe('')

      vp.height = 561
      vp.fire('resize')
      vi.advanceTimersByTime(300)
      expect(element.style.bottom).toBe('291px')

      vp.height = 852
      vp.fire('resize')
      vi.advanceTimersByTime(300)
      expect(element.style.bottom).toBe('')

      popup.destroy()
      shadow.destroy()
    })

    it('stops tracking the keyboard once destroyed', () => {
      narrow(393)
      Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true, writable: true })
      const vp = fakeViewport(852)

      const { shadow, popup, element } = openSheet()
      popup.destroy()

      vp.height = 561
      vp.fire('resize')
      vi.advanceTimersByTime(500)
      expect(element.style.bottom).toBe('')

      shadow.destroy()
    })

    // releaseElement hands the node to the clarify flow and destroy() never
    // runs, so the observer has to be dropped there too.
    it('stops tracking the keyboard once the element is released', () => {
      narrow(393)
      Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true, writable: true })
      const vp = fakeViewport(852)

      const { shadow, popup } = openSheet()
      const released = popup.releaseElement()

      vp.height = 561
      vp.fire('resize')
      vi.advanceTimersByTime(500)
      expect(released.style.bottom).toBe('')

      shadow.destroy()
    })

    it('keeps anchored positioning above the breakpoint', () => {
      narrow(1024)
      const { shadow, popup, element } = openSheet()

      expect(element.style.left).not.toBe('')
      expect(element.style.top).not.toBe('')

      popup.destroy()
      shadow.destroy()
    })
  })

  describe('where it opens', () => {
    const place = (targetRect?: { top: number; left: number; width: number; height: number; bottom: number }) => {
      const shadow = new ShadowContainer()
      const popup = new CommentPopup(shadow, {
        targetName: 'anything',
        x: 1600,
        y: 300,
        targetRect: targetRect as never,
        messages: getMessages('en'),
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      })
      const el = shadow.root.querySelector('.mtb-popup') as HTMLElement
      const at = { left: parseFloat(el.style.left), top: parseFloat(el.style.top) }
      popup.destroy()
      shadow.destroy()
      return at
    }

    it('sits beside a target small enough to point at', () => {
      const at = place({ top: 200, left: 300, width: 120, height: 40, bottom: 240 })
      expect(at.left).toBe(300)
      expect(at.top).toBe(248)
    })

    // Clicking empty space lands on whatever section spans the page. Its rect
    // says nothing about where the click was — anchoring to it put the popup in
    // the bottom-left corner no matter how far right the user had clicked.
    it('follows the click when the target is the size of the page', () => {
      const at = place({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, bottom: window.innerHeight })

      expect(at.top).toBe(312)
      expect(at.left).toBeGreaterThan(window.innerWidth / 2)
    })

    it('follows the click when there is no target at all', () => {
      const at = place(undefined)
      expect(at.top).toBe(312)
    })
  })

  describe('accessibility', () => {
    it('announces itself as a modal dialog', () => {
      const { shadow, popup } = setupPopup()

      const el = shadow.root.querySelector('.mtb-popup')!
      expect(el.getAttribute('role')).toBe('dialog')
      expect(el.getAttribute('aria-modal')).toBe('true')
      expect(el.getAttribute('aria-label')).toContain('Export PDF')

      popup.destroy()
      shadow.destroy()
    })

    // The close button's label was the one hardcoded English string in the
    // package — a zh-CN reporter's screen reader read "Close" in a fully
    // translated panel.
    it('labels the close button through the locale messages', () => {
      const shadow = new ShadowContainer()
      const messages = getMessages('zh-CN')
      const popup = new CommentPopup(shadow, {
        targetName: 'Export PDF',
        x: 100,
        y: 120,
        messages,
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      })

      expect(shadow.root.querySelector('.mtb-popup-close')?.getAttribute('aria-label')).toBe(messages.popup.close)

      popup.destroy()
      shadow.destroy()
    })

    it('Tab on the last control wraps back to the first', () => {
      const { shadow, popup } = setupPopup()

      const el = shadow.root.querySelector<HTMLElement>('.mtb-popup')!
      // Submit is disabled while the textarea is empty, so cancel is the last
      // tabbable control.
      const first = shadow.root.querySelector<HTMLElement>('.mtb-popup-close')!
      const last = shadow.root.querySelector<HTMLElement>('.mtb-cancel-btn')!

      last.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      el.dispatchEvent(tab)

      expect(tab.defaultPrevented).toBe(true)
      expect(shadow.root.activeElement ?? document.activeElement).toBe(first)

      popup.destroy()
      shadow.destroy()
    })

    it('Shift+Tab on the first control wraps to the last', () => {
      const { shadow, popup } = setupPopup()

      const el = shadow.root.querySelector<HTMLElement>('.mtb-popup')!
      const first = shadow.root.querySelector<HTMLElement>('.mtb-popup-close')!
      const last = shadow.root.querySelector<HTMLElement>('.mtb-cancel-btn')!

      first.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      el.dispatchEvent(tab)

      expect(tab.defaultPrevented).toBe(true)
      expect(shadow.root.activeElement ?? document.activeElement).toBe(last)

      popup.destroy()
      shadow.destroy()
    })

    it('returns focus to the opener after destroy', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { shadow, popup } = setupPopup()
      popup.destroy()

      expect(document.activeElement).toBe(opener)

      shadow.destroy()
      opener.remove()
    })

    // releaseElement hands the DOM node to the clarify continuation, which
    // installs its own trap: the popup's Tab handler must be gone, and focus
    // must stay where the continuation left it.
    it('releaseElement removes the Tab handler without moving focus', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { shadow, popup } = setupPopup()
      const el = popup.releaseElement()

      const last = el.querySelector<HTMLElement>('.mtb-cancel-btn')!
      last.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      el.dispatchEvent(tab)

      expect(tab.defaultPrevented).toBe(false)
      expect(document.activeElement).not.toBe(opener)

      el.remove()
      shadow.destroy()
      opener.remove()
    })
  })
})
