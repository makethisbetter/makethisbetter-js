import { describe, expect, it, vi } from 'vitest'
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

describe('CommentPopup', () => {
  it('renders visible submit and cancel actions', () => {
    const { shadow, popup } = setupPopup()

    expect(shadow.root.querySelector('.mtb-submit-btn')?.textContent).toBe('Submit')
    expect(shadow.root.querySelector('.mtb-cancel-btn')?.textContent).toBe('Cancel')

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

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onSubmit).toHaveBeenCalledWith('Export does not work')

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
})
