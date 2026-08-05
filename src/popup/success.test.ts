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

  it('auto-closes once the email is saved', async () => {
    const shadow = new ShadowContainer()
    const onClose = vi.fn()
    const card = new SuccessCard(shadow, getMessages('en'), onClose, undefined, {
      emailCapture: { onSubmit: vi.fn(async () => true) },
    })

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-email-input')!
    input.value = 'anon@example.com'
    shadow.root.querySelector<HTMLButtonElement>('.mtb-email-submit')!.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(shadow.root.querySelector('.mtb-email-saved')).toBeTruthy()

    vi.advanceTimersByTime(5000)
    expect(onClose).toHaveBeenCalledTimes(1)

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

  it('renders locale messages as text', () => {
    const shadow = new ShadowContainer()
    const messages = structuredClone(getMessages('en'))
    const payload = '<img src=x onerror="window.widgetXss=true">'
    Object.keys(messages.success).forEach((key) => {
      const success = messages.success as Record<string, string>
      success[key] = payload
    })

    const card = new SuccessCard(shadow, messages, vi.fn(), vi.fn(), {
      emailCapture: { onSubmit: vi.fn(async () => true) },
    })

    expect(shadow.root.querySelector('img')).toBeNull()
    expect(shadow.root.querySelector('.mtb-success-title')?.textContent).toBe(payload)
    expect(shadow.root.querySelector('.mtb-email-input')?.getAttribute('placeholder')).toBe(payload)

    card.destroy()
    shadow.destroy()
  })

  // The timer used to run loose: dismiss card 1 early, submit again, and
  // card 1's leftover timer closed whichever card was current at the original
  // deadline.
  it('destroy cancels the pending auto-close', () => {
    const { shadow, card, onClose } = setupCard()

    vi.advanceTimersByTime(1000)
    card.destroy()
    vi.advanceTimersByTime(10000)
    expect(onClose).not.toHaveBeenCalled()

    shadow.destroy()
  })

  it('a card mounted after an early dismissal keeps its full auto-close window', () => {
    const shadow = new ShadowContainer()
    const messages = getMessages('en')
    const onCloseFirst = vi.fn()
    const first = new SuccessCard(shadow, messages, onCloseFirst)

    vi.advanceTimersByTime(1000)
    first.destroy()

    const onCloseSecond = vi.fn()
    const second = new SuccessCard(shadow, messages, onCloseSecond)

    // t=5s from the first card's mount — where its stray timer used to fire.
    vi.advanceTimersByTime(4000)
    expect(onCloseSecond).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(onCloseSecond).toHaveBeenCalledOnce()
    expect(onCloseFirst).not.toHaveBeenCalled()

    second.destroy()
    shadow.destroy()
  })

  it('announces itself as a modal dialog', () => {
    const { shadow, card, messages } = setupCard()

    const el = shadow.root.querySelector('.mtb-success')!
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(el.getAttribute('aria-label')).toBe(messages.success.title)

    card.destroy()
    shadow.destroy()
  })

  it('Tab on the last control wraps back to the first', () => {
    const shadow = new ShadowContainer()
    const card = new SuccessCard(shadow, getMessages('en'), vi.fn(), undefined, {
      emailCapture: { onSubmit: vi.fn(async () => true) },
    })

    const el = shadow.root.querySelector<HTMLElement>('.mtb-success')!
    const firstTabbable = shadow.root.querySelector<HTMLElement>('.mtb-email-input')!
    const lastTabbable = shadow.root.querySelector<HTMLElement>('.mtb-close-link')!

    lastTabbable.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    el.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(true)
    expect(shadow.root.activeElement ?? document.activeElement).toBe(firstTabbable)

    card.destroy()
    shadow.destroy()
  })

  it('returns focus to the opener after destroy', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { shadow, card } = setupCard()
    card.destroy()

    expect(document.activeElement).toBe(opener)

    shadow.destroy()
    opener.remove()
  })
})
