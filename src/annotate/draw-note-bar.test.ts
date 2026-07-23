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

  it('shows a dot spinner while loading and restores the label after', () => {
    setup()
    const submitBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-submit')!
    const label = submitBtn.textContent

    bar.setLoading(true)
    expect(submitBtn.disabled).toBe(true)
    expect(submitBtn.classList.contains('loading')).toBe(true)
    expect(submitBtn.querySelectorAll('.mtb-dot').length).toBe(3)

    bar.setLoading(false)
    expect(submitBtn.classList.contains('loading')).toBe(false)
    expect(submitBtn.textContent).toBe(label)
  })

  it('submits the trimmed note', () => {
    const handlers = setup()
    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-draw-input')!
    input.value = '  fix this  '
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-submit')!.click()
    expect(handlers.onSubmit).toHaveBeenCalledWith('fix this')
  })

  it('submits an empty string when the note is blank', () => {
    const handlers = setup()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-draw-submit')!.click()
    expect(handlers.onSubmit).toHaveBeenCalledWith('')
  })
})
