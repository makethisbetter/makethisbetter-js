import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrustrationPromptCard } from './frustration-prompt'
import { ShadowContainer } from './shadow'
import { getMessages } from '../i18n'

function setupPrompt() {
  const shadow = new ShadowContainer()
  const onTell = vi.fn()
  const onDismiss = vi.fn()
  const messages = getMessages('en')
  const card = new FrustrationPromptCard(shadow, messages, { onTell, onDismiss })

  return { shadow, card, onTell, onDismiss, messages }
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

  it('auto-dismisses after 8 seconds', () => {
    const { shadow, card, onDismiss } = setupPrompt()

    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8000)
    expect(onDismiss).toHaveBeenCalled()

    card.destroy()
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
