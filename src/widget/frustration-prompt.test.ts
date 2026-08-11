import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrustrationPromptCard } from './frustration-prompt'
import { ShadowContainer } from './shadow'
import { getMessages } from '../i18n'

function setupPrompt() {
  const shadow = new ShadowContainer()
  const onTell = vi.fn()
  const onDismiss = vi.fn()
  const onAutoHide = vi.fn()
  const messages = getMessages('en')
  const card = new FrustrationPromptCard(shadow, messages, { onTell, onDismiss, onAutoHide })

  return { shadow, card, onTell, onDismiss, onAutoHide, messages }
}

describe('FrustrationPromptCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders prompt text and action buttons', () => {
    const { shadow, card, messages } = setupPrompt()

    expect(shadow.root.querySelector('.mtb-frustration-text')?.textContent).toBe(messages.frustration.prompt)
    expect(shadow.root.querySelector('.mtb-frustration-tell')?.textContent).toBe(messages.frustration.action)
    expect(shadow.root.querySelector('.mtb-frustration-dismiss')?.textContent).toBe(messages.frustration.dismiss)

    card.destroy()
    shadow.destroy()
  })

  it('renders locale messages as text', () => {
    const shadow = new ShadowContainer()
    const messages = structuredClone(getMessages('en'))
    const payload = '<img src=x onerror="window.widgetXss=true">'
    messages.frustration.prompt = payload
    messages.frustration.action = payload
    messages.frustration.dismiss = payload
    const card = new FrustrationPromptCard(shadow, messages, {
      onTell: vi.fn(),
      onDismiss: vi.fn(),
      onAutoHide: vi.fn(),
    })

    expect(shadow.root.querySelector('img')).toBeNull()
    expect(shadow.root.querySelector('.mtb-frustration-text')?.textContent).toBe(payload)

    card.destroy()
    shadow.destroy()
  })

  it('renders warning icon', () => {
    const { shadow, card } = setupPrompt()

    const icon = shadow.root.querySelector('.mtb-frustration-icon')
    expect(icon).toBeTruthy()

    card.destroy()
    shadow.destroy()
  })

  it('calls onTell when tell button is clicked', () => {
    const { shadow, card, onTell } = setupPrompt()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-frustration-tell')!.click()
    expect(onTell).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('calls onDismiss when dismiss button is clicked', () => {
    const { shadow, card, onDismiss } = setupPrompt()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-frustration-dismiss')!.click()
    expect(onDismiss).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  // An unnoticed card is not a refusal. It must reach onAutoHide, never
  // onDismiss, or the controller records a decision the user never made and
  // suppresses every later prompt for the session.
  it('auto-hides after 8 seconds without reporting a user dismissal', () => {
    const { shadow, card, onAutoHide, onDismiss } = setupPrompt()

    expect(onAutoHide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8000)
    expect(onAutoHide).toHaveBeenCalledOnce()
    expect(onDismiss).not.toHaveBeenCalled()

    card.destroy()
    shadow.destroy()
  })

  it('destroy cancels the pending auto-hide', () => {
    const { shadow, card, onAutoHide, onDismiss } = setupPrompt()

    card.destroy()
    vi.advanceTimersByTime(30_000)

    expect(onAutoHide).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()

    shadow.destroy()
  })

  it('does not fire the auto-hide after the reporter engages via Tell us', () => {
    const { shadow, card, onTell, onAutoHide } = setupPrompt()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-frustration-tell')!.click()
    expect(onTell).toHaveBeenCalledOnce()
    // The controller destroys the card on engagement; the stale timer used to
    // fire 8s later and disable all future prompts.
    card.destroy()
    vi.advanceTimersByTime(30_000)

    expect(onAutoHide).not.toHaveBeenCalled()

    shadow.destroy()
  })

  it('destroy removes element from shadow root', () => {
    const { shadow, card } = setupPrompt()

    expect(shadow.root.querySelector('.mtb-frustration-prompt')).toBeTruthy()
    card.destroy()
    expect(shadow.root.querySelector('.mtb-frustration-prompt')).toBeNull()

    shadow.destroy()
  })
})
