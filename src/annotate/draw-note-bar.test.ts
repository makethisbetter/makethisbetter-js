import { afterEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { DrawNoteBar } from './draw-note-bar'
import { getMessages } from '../i18n'

describe('DrawNoteBar', () => {
  let shadow: ShadowContainer
  let bar: DrawNoteBar

  function setup() {
    shadow = new ShadowContainer()
    const handlers = {
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
    }
    bar = new DrawNoteBar(shadow, { messages: getMessages('en'), ...handlers })
    return handlers
  }

  afterEach(() => {
    bar.destroy()
    shadow.destroy()
    document.body.innerHTML = ''
  })

  // A drawing is strokes baked onto the screenshot, so there is no opting out
  // here — but the reporter is still told the screenshot is going with it.
  it('discloses the screenshot without offering a choice', () => {
    setup()
    const box = shadow.root.querySelector<HTMLInputElement>('.mtb-draw-shot input')!
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    expect(shadow.root.querySelector('.mtb-draw-shot span')!.textContent)
      .toBe(getMessages('en').popup.screenshot_short)
  })

  it('renders the screenshot label as text, never as markup', () => {
    shadow = new ShadowContainer()
    const messages = structuredClone(getMessages('en'))
    const payload = '<img src=x onerror="window.widgetXss=true">'
    messages.popup.screenshot_short = payload
    messages.popup.screenshot_locked_hint = payload
    bar = new DrawNoteBar(shadow, {
      messages,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
    })

    expect(shadow.root.querySelector('.mtb-draw-shot span')!.textContent).toBe(payload)
    expect(shadow.root.querySelector('.mtb-draw-shot img')).toBeNull()
  })

  it('renders note input, undo, redo, cancel and submit', () => {
    setup()
    expect(shadow.root.querySelector('.mtb-draw-input')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-draw-undo')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-draw-redo')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-draw-cancel')!.textContent).toBe(getMessages('en').draw.cancel)
    expect(shadow.root.querySelector('.mtb-draw-submit')!.textContent).toBe(getMessages('en').draw.submit)
  })

  it('disables undo and redo by default', () => {
    setup()
    expect(shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-undo')!.disabled).toBe(true)
    expect(shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-redo')!.disabled).toBe(true)
  })

  it('setUndoRedo toggles the button disabled state', () => {
    setup()
    bar.setUndoRedo(true, false)
    expect(shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-undo')!.disabled).toBe(false)
    expect(shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-redo')!.disabled).toBe(true)
  })

  it('fires callbacks for undo, redo and cancel', () => {
    const handlers = setup()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-undo')!.disabled = false
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-undo')!.click()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-redo')!.disabled = false
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-redo')!.click()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-cancel')!.click()
    expect(handlers.onUndo).toHaveBeenCalledOnce()
    expect(handlers.onRedo).toHaveBeenCalledOnce()
    expect(handlers.onCancel).toHaveBeenCalledOnce()
  })

  it('submits the trimmed note via click (no keydown)', () => {
    const handlers = setup()
    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-draw-input')!
    input.value = '  fix this  '
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-submit')!.click()
    expect(handlers.onSubmit).toHaveBeenCalledWith('fix this', undefined)
  })

  it('submits an empty string when the note is blank', () => {
    const handlers = setup()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-submit')!.click()
    expect(handlers.onSubmit).toHaveBeenCalledWith('', undefined)
  })

  // The Enter that submitted the draw bar used to not travel to the clarify
  // card, causing it to be seen as "a new Enter" and immediately skip the
  // follow-up question. The keydown must be forwarded so the card can ignore
  // exactly that event.
  it('forwards the Enter keydown so the clarify card can ignore it', () => {
    const handlers = setup()
    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-draw-input')!
    input.value = 'broken export'
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    input.dispatchEvent(enter)
    expect(handlers.onSubmit).toHaveBeenCalledWith('broken export', enter)
  })

  // This bar was unreachable on a phone until freehand drawing started
  // working. It sits flush to the bottom there and carries a text field, so
  // the keyboard lands squarely on top of it.
  describe('narrow viewport', () => {
    function narrow(vpHeight: number) {
      Object.defineProperty(window, 'innerWidth', { value: 393, configurable: true, writable: true })
      Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true, writable: true })
      Object.defineProperty(window, 'visualViewport', {
        value: { height: vpHeight, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
        configurable: true,
        writable: true,
      })
    }

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })
    })

    it('sits above an open keyboard', () => {
      narrow(561)
      setup()
      expect(shadow.root.querySelector<HTMLElement>('.mtb-draw-bar')!.style.bottom).toBe('291px')
    })

    it('stays put when no keyboard is open', () => {
      narrow(852)
      setup()
      expect(shadow.root.querySelector<HTMLElement>('.mtb-draw-bar')!.style.bottom).toBe('')
    })
  })
})
