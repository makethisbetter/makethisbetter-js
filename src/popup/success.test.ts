import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuccessCard } from './success'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'

function setupCard() {
  const shadow = new ShadowContainer()
  const onClose = vi.fn()
  const messages = getMessages('en')
  const card = new SuccessCard(shadow, messages, onClose)

  return { shadow, card, onClose, messages }
}

describe('SuccessCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title, message, and close button', () => {
    const { shadow, card, messages } = setupCard()

    expect(shadow.root.querySelector('.mtb-success-title')?.textContent).toBe(messages.success.title)
    expect(shadow.root.querySelector('.mtb-success-msg')?.textContent).toBe(messages.success.message)
    expect(shadow.root.querySelector('.mtb-close-link')?.textContent).toBe(messages.success.close)

    card.destroy()
    shadow.destroy()
  })

  it('renders checkmark icon', () => {
    const { shadow, card } = setupCard()

    const icon = shadow.root.querySelector('.mtb-success-icon svg')
    expect(icon).toBeTruthy()

    card.destroy()
    shadow.destroy()
  })

  it('calls onClose when close button is clicked', () => {
    const { shadow, card, onClose } = setupCard()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-close-link')!.click()
    expect(onClose).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('auto-closes after 5 seconds', () => {
    const { shadow, card, onClose } = setupCard()

    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(onClose).toHaveBeenCalled()

    card.destroy()
    shadow.destroy()
  })

  it('destroy removes element from shadow root', () => {
    const { shadow, card } = setupCard()

    expect(shadow.root.querySelector('.mtb-success')).toBeTruthy()
    card.destroy()
    expect(shadow.root.querySelector('.mtb-success')).toBeNull()

    shadow.destroy()
  })

  it('renders the email capture form when emailCapture is provided', () => {
    const shadow = new ShadowContainer()
    const messages = getMessages('en')
    const card = new SuccessCard(shadow, messages, vi.fn(), undefined, {
      emailCapture: { onSubmit: vi.fn(async () => true) },
    })

    expect(shadow.root.querySelector('.mtb-email-prompt')?.textContent).toBe(messages.success.email_prompt)
    expect(shadow.root.querySelector('.mtb-email-input')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-email-submit')?.textContent).toBe(messages.success.email_submit)

    card.destroy()
    shadow.destroy()
  })

  it('does not render the email form without emailCapture', () => {
    const { shadow, card } = setupCard()

    expect(shadow.root.querySelector('.mtb-email-input')).toBeNull()

    card.destroy()
    shadow.destroy()
  })

  it('does not auto-close while the email form is shown', () => {
    const shadow = new ShadowContainer()
    const onClose = vi.fn()
    const card = new SuccessCard(shadow, getMessages('en'), onClose, undefined, {
      emailCapture: { onSubmit: vi.fn(async () => true) },
    })

    vi.advanceTimersByTime(10000)
    expect(onClose).not.toHaveBeenCalled()

    card.destroy()
    shadow.destroy()
  })

  it('submits a valid email and shows the saved confirmation', async () => {
    const shadow = new ShadowContainer()
    const messages = getMessages('en')
    const onSubmit = vi.fn(async () => true)
    const card = new SuccessCard(shadow, messages, vi.fn(), undefined, {
      emailCapture: { onSubmit },
    })

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-email-input')!
    input.value = 'anon@example.com'
    shadow.root.querySelector<HTMLButtonElement>('.mtb-email-submit')!.click()

    expect(onSubmit).toHaveBeenCalledWith('anon@example.com')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(shadow.root.querySelector('.mtb-email-saved')?.textContent).toBe(messages.success.email_saved)
    expect(shadow.root.querySelector('.mtb-email-input')).toBeNull()

    card.destroy()
    shadow.destroy()
  })

  it('does not call onSubmit for an invalid email', () => {
    const shadow = new ShadowContainer()
    const onSubmit = vi.fn(async () => true)
    const card = new SuccessCard(shadow, getMessages('en'), vi.fn(), undefined, {
      emailCapture: { onSubmit },
    })

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-email-input')!
    input.value = 'not-an-email'
    shadow.root.querySelector<HTMLButtonElement>('.mtb-email-submit')!.click()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(shadow.root.querySelector('.mtb-email-input')).toBeTruthy()

    card.destroy()
    shadow.destroy()
  })

  it('shows an error and keeps the form when saving fails', async () => {
    const shadow = new ShadowContainer()
    const messages = getMessages('en')
    const card = new SuccessCard(shadow, messages, vi.fn(), undefined, {
      emailCapture: { onSubmit: vi.fn(async () => false) },
    })

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-email-input')!
    input.value = 'anon@example.com'
    shadow.root.querySelector<HTMLButtonElement>('.mtb-email-submit')!.click()

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(shadow.root.querySelector('.mtb-email-error')?.textContent).toBe(messages.success.email_error)
    expect(shadow.root.querySelector('.mtb-email-input')).toBeTruthy()

    card.destroy()
    shadow.destroy()
  })

  it('shows depleted copy when skipFollowup is true', () => {
    const shadow = new ShadowContainer()
    const onClose = vi.fn()
    const messages = getMessages('en')
    const card = new SuccessCard(shadow, messages, onClose, undefined, { skipFollowup: true })

    expect(shadow.root.querySelector('.mtb-success-title')?.textContent).toBe(messages.success.title_no_ai)
    expect(shadow.root.querySelector('.mtb-success-msg')?.textContent).toBe(messages.success.message_no_ai)

    card.destroy()
    shadow.destroy()
  })
})
