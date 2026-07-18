import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClarifyCard } from './clarify'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'
import type { ApiClient } from '../api/client'
import type { ClarifyResponse } from '../types'

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    submitFeedback: vi.fn(),
    startClarification: vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'Can you tell me more?' }],
      done: false,
    } satisfies ClarifyResponse),
    getClarification: vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'Can you tell me more?' }],
      done: false,
    } satisfies ClarifyResponse),
    ...overrides,
  } as unknown as ApiClient
}

function setupCard(apiOverrides: Partial<ApiClient> = {}, pos?: { x: number; y: number }) {
  const shadow = new ShadowContainer()
  const onDone = vi.fn()
  const apiClient = mockApiClient(apiOverrides)
  const messages = getMessages('en')

  const card = new ClarifyCard(shadow, {
    feedbackId: 'fb_123',
    apiClient,
    messages,
    onDone,
    x: pos?.x,
    y: pos?.y,
  })

  return { shadow, card, onDone, apiClient, messages }
}

describe('ClarifyCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates DOM elements in shadow container', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    expect(shadow.root.querySelector('.mtb-clarify')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-messages')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-input')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-send')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-skip')).toBeTruthy()

    card.destroy()
    shadow.destroy()
  })

  it('renders header with skip button', async () => {
    const { shadow, card, messages, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    const skip = shadow.root.querySelector('.mtb-clarify-skip')
    expect(skip?.textContent).toBe(messages.clarify.skip)

    card.destroy()
    shadow.destroy()
  })

  it('anchors near the given position instead of a fixed corner', async () => {
    const { shadow, card } = setupCard({}, { x: 400, y: 300 })
    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-clarify')!
    // Positioned via left/top near the point, not pinned to a corner.
    expect(el.style.left).toBe('412px')
    expect(el.style.top).toBe('312px')
    expect(el.style.right).toBe('')
    expect(el.style.bottom).toBe('')

    card.destroy()
    shadow.destroy()
  })

  it('clamps to the viewport when the point is near a screen edge', async () => {
    // jsdom default viewport is 1024x768; a point at the far-right/bottom must
    // pull the card back inside so it never overflows off-screen.
    const { shadow, card } = setupCard({}, { x: 1020, y: 760 })
    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-clarify')!
    const left = parseInt(el.style.left, 10)
    const top = parseInt(el.style.top, 10)
    expect(left + 346).toBeLessThanOrEqual(1024)
    expect(top).toBeGreaterThanOrEqual(12)
    expect(top).toBeLessThanOrEqual(768 - 12)

    card.destroy()
    shadow.destroy()
  })

  it('renders the redesigned header title and subtitle', async () => {
    const { shadow, card, messages } = setupCard()
    expect(shadow.root.querySelector('.mtb-clarify-title')?.textContent).toBe(messages.clarify.title)
    expect(shadow.root.querySelector('.mtb-clarify-subtitle')?.textContent).toBe(messages.clarify.subtitle)

    card.destroy()
    shadow.destroy()
  })

  it('header close button ends the conversation', async () => {
    const { shadow, card, onDone } = setupCard()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()
    expect(onDone).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('falls back to startClarification when streaming is unavailable', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalledWith('fb_123', undefined)
    })

    card.destroy()
    shadow.destroy()
  })

  it('renders messages from startClarification response', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'What happened exactly?' }],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    const bubbles = shadow.root.querySelectorAll('.mtb-clarify-bubble')
    const aiBubble = shadow.root.querySelector('.mtb-clarify-ai')
    expect(aiBubble?.textContent).toBe('What happened exactly?')

    card.destroy()
    shadow.destroy()
  })

  it('skip button calls onDone', async () => {
    const { shadow, card, onDone, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()
    expect(onDone).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('send button stays enabled (green) even when input is empty', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    // The mockup keeps Send green at all times; the empty-input guard lives in
    // the send handler, not a disabled attribute.
    const sendBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!
    expect(sendBtn.disabled).toBe(false)

    card.destroy()
    shadow.destroy()
  })

  it('does not send when input is empty or whitespace-only', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'Tell me more' }],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!
    const sendBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!

    input.value = '   '
    input.dispatchEvent(new Event('input'))
    sendBtn.click()

    // No second turn — whitespace is guarded in the send handler.
    await vi.advanceTimersByTimeAsync(0)
    expect(startClarification).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('sends user message via apiClient', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [
          { role: 'assistant', content: 'Tell me more' },
          { role: 'user', content: 'Button does nothing' },
          { role: 'assistant', content: 'Got it' },
        ],
        done: false,
      } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-clarify-input')!
    const sendBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!

    input.value = 'Button does nothing'
    input.dispatchEvent(new Event('input'))
    sendBtn.click()

    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledTimes(2)
    })
    expect(startClarification).toHaveBeenCalledWith('fb_123', 'Button does nothing')

    card.destroy()
    shadow.destroy()
  })

  it('Enter key sends the message', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [],
        done: false,
      } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-clarify-input')!
    input.value = 'Help me'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledTimes(2)
    })
    expect(startClarification).toHaveBeenCalledWith('fb_123', 'Help me')

    card.destroy()
    shadow.destroy()
  })

  it('clears input after sending', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [{ role: 'assistant', content: 'Go on' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [],
        done: false,
      } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-clarify-input')!
    input.value = 'Something'
    input.dispatchEvent(new Event('input'))
    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!.click()

    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledTimes(2)
    })

    expect(input.value).toBe('')

    card.destroy()
    shadow.destroy()
  })

  it('starts polling after non-done response', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'Still thinking' }],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card, apiClient } = setupCard({ getClarification })
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(getClarification).toHaveBeenCalledWith('fb_123')

    await vi.advanceTimersByTimeAsync(2000)
    expect(getClarification).toHaveBeenCalledTimes(2)

    card.destroy()
    shadow.destroy()
  })

  it('auto-completes and calls onDone when done=true from start', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'complete',
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card, onDone } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(onDone).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(onDone).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('auto-completes when polling returns done=true', async () => {
    const getClarification = vi.fn().mockResolvedValueOnce({
      status: 'complete',
      messages: [{ role: 'assistant', content: 'Done' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card, onDone } = setupCard({ getClarification })
    await vi.waitFor(() => {
      expect(card).toBeTruthy()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(onDone).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('disables input and send after done', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'complete',
      messages: [{ role: 'assistant', content: 'Resolved' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-clarify-input')!
    const sendBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!
    expect(input.disabled).toBe(true)
    expect(sendBtn.disabled).toBe(true)

    card.destroy()
    shadow.destroy()
  })

  it('calls onDone on startClarification error', async () => {
    const startClarification = vi.fn().mockRejectedValue(new Error('Network error'))

    const { shadow, card, onDone } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(onDone).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('destroy removes element from shadow root', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    expect(shadow.root.querySelector('.mtb-clarify')).toBeTruthy()
    card.destroy()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()

    shadow.destroy()
  })

  it('ignores Enter during IME composition', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'pending',
        messages: [],
        done: false,
      } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-clarify-input')!
    input.value = '导出坏了'
    input.dispatchEvent(new Event('input'))

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    expect(startClarification).toHaveBeenCalledOnce()

    const legacyImeEnter = new KeyboardEvent('keydown', { key: 'Enter' })
    Object.defineProperty(legacyImeEnter, 'keyCode', { value: 229 })
    input.dispatchEvent(legacyImeEnter)
    expect(startClarification).toHaveBeenCalledOnce()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledTimes(2)
    })
    expect(startClarification).toHaveBeenCalledWith('fb_123', '导出坏了')

    card.destroy()
    shadow.destroy()
  })

  it('keeps thinking indicator while waiting for the AI reply', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)
    const getClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification, getClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeTruthy()

    card.destroy()
    shadow.destroy()
  })

  it('removes thinking indicator when the AI reply arrives', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)
    const getClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'What broke?' }],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification, getClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('What broke?')

    card.destroy()
    shadow.destroy()
  })

  it('renders streamed deltas live and completes on the stream result', async () => {
    const streamClarification = vi.fn().mockImplementation(
      async (_id: string, _msg: string | undefined, onDelta: (t: string) => void) => {
        onDelta('What ')
        onDelta('broke?')
        return {
          messages: [{ role: 'assistant', content: 'What broke?' }],
          done: false,
        }
      },
    )

    const { shadow, card } = setupCard({ streamClarification } as never)
    await vi.waitFor(() => {
      expect(streamClarification).toHaveBeenCalledWith('fb_123', undefined, expect.any(Function))
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('What broke?')

    card.destroy()
    shadow.destroy()
  })

  it('completes via streaming done and stops without polling', async () => {
    const streamClarification = vi.fn().mockResolvedValue({
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    })
    const getClarification = vi.fn()

    const { shadow, card, onDone } = setupCard({ streamClarification, getClarification } as never)
    await vi.waitFor(() => {
      expect(streamClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(onDone).toHaveBeenCalledOnce()
    expect(getClarification).not.toHaveBeenCalled()

    card.destroy()
    shadow.destroy()
  })

  it('ends the conversation when polling exceeds the timeout with no reply', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card, onDone } = setupCard({ getClarification })
    await vi.waitFor(() => {
      expect(card).toBeTruthy()
    })
    await vi.advanceTimersByTimeAsync(0)

    // Poll past the 45s deadline; the card should give up and call onDone.
    await vi.advanceTimersByTimeAsync(48000)
    expect(onDone).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('stops polling on destroy', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card, apiClient } = setupCard({ getClarification })
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    card.destroy()

    getClarification.mockClear()
    await vi.advanceTimersByTimeAsync(4000)
    expect(getClarification).not.toHaveBeenCalled()

    shadow.destroy()
  })
})
