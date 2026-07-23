import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClarifyCard } from './clarify'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'
import type { ApiClient } from '../api/client'
import type { ClarifyResponse } from '../types'

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
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
    retryClarification: vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [{ role: 'assistant', content: 'Can you tell me more?' }],
      done: false,
    } satisfies ClarifyResponse),
    ...overrides,
  } as unknown as ApiClient
}

function setupCard(apiOverrides: Partial<ApiClient> = {}, pos?: { x: number; y: number }) {
  const shadow = new ShadowContainer()
  const onFinalize = vi.fn()
  const apiClient = mockApiClient(apiOverrides)
  const messages = getMessages('en')

  const card = new ClarifyCard(shadow, {
    submissionSessionId: 'submission_123',
    submissionToken: 'submission-secret',
    apiClient,
    messages,
    onFinalize,
    x: pos?.x,
    y: pos?.y,
  })

  return { shadow, card, onFinalize, apiClient, messages }
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

  it('reuses the current popup element without moving or replaying its entrance', async () => {
    const shadow = new ShadowContainer()
    const element = shadow.el<HTMLDivElement>('div', 'mtb-popup')
    element.style.left = '40px'
    element.style.top = '60px'
    shadow.append(element)

    const apiClient = mockApiClient()
    const card = new ClarifyCard(shadow, {
      submissionSessionId: 'submission_123',
      submissionToken: 'submission-secret',
      apiClient,
      messages: getMessages('en'),
      onFinalize: vi.fn(),
      element,
      x: 400,
      y: 300,
    })

    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })
    expect(shadow.root.querySelector('.mtb-clarify')).toBe(element)
    expect(element.className).toBe('mtb-clarify mtb-clarify-continuation')
    expect(element.style.left).toBe('40px')
    expect(element.style.top).toBe('60px')
    expect(shadow.root.children).toHaveLength(2)

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
    expect(left + 346).toBeLessThanOrEqual(1024 - 44)
    expect(top).toBeGreaterThanOrEqual(12)
    expect(top).toBeLessThanOrEqual(768 - 12)

    card.destroy()
    shadow.destroy()
  })

  it('leaves room for a left-side feedback tab', async () => {
    const shadow = new ShadowContainer()
    const card = new ClarifyCard(shadow, {
      submissionSessionId: 'submission_123',
      submissionToken: 'submission-secret',
      apiClient: mockApiClient(),
      messages: getMessages('en'),
      onFinalize: vi.fn(),
      position: 'left',
      x: 0,
      y: 300,
    })
    const element = shadow.root.querySelector<HTMLDivElement>('.mtb-clarify')!

    expect(Number.parseFloat(element.style.left)).toBeGreaterThanOrEqual(44)

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
    const { shadow, card, onFinalize } = setupCard()
    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()
    expect(onFinalize).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('falls back to startClarification when streaming is unavailable', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret')
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

  it('Skip & send calls onFinalize', async () => {
    const { shadow, card, onFinalize, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()
    expect(onFinalize).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('send button is disabled when input is empty and enabled when text is entered', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    const sendBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!
    const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!

    expect(sendBtn.disabled).toBe(true)

    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    expect(sendBtn.disabled).toBe(false)

    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(sendBtn.disabled).toBe(true)

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
        status: 'completed',
        messages: [
          { role: 'assistant', content: 'Tell me more' },
          { role: 'user', content: 'Button does nothing' },
          { role: 'assistant', content: 'Got it' },
        ],
        done: true,
      } satisfies ClarifyResponse)

    const { shadow, card, onFinalize } = setupCard({ startClarification })
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
    expect(startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret', 'Button does nothing')
    expect(onFinalize).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeTruthy()
    })
    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!.click()
    expect(onFinalize).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('keeps the answer editable when saving it fails', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'awaiting_response',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockRejectedValueOnce(new Error('Network error'))

    const { shadow, card, messages, onFinalize } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!
    input.value = 'Button does nothing'
    input.dispatchEvent(new Event('input'))
    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!.click()

    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.error.submit)
    })
    expect(onFinalize).not.toHaveBeenCalled()
    expect(input.value).toBe('Button does nothing')
    expect(input.disabled).toBe(false)

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
    expect(startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret', 'Help me')

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
    expect(getClarification).toHaveBeenCalledWith('submission_123', 'submission-secret')

    await vi.advanceTimersByTimeAsync(2000)
    expect(getClarification).toHaveBeenCalledTimes(2)

    card.destroy()
    shadow.destroy()
  })

  it('waits for Send feedback when done=true from start', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'complete',
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card, onFinalize } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('All clear, thanks!')
    expect(onFinalize).not.toHaveBeenCalled()

    const sendFeedback = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!
    expect(sendFeedback).toBeTruthy()
    sendFeedback.click()
    expect(onFinalize).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('shows a clarification failure before allowing fallback submission', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'failed',
      messages: [],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card, onFinalize, messages } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.clarify.error)
    expect(shadow.root.querySelector('.mtb-clarify-fallback')?.textContent).toBe(messages.clarify.send_feedback)
    expect(onFinalize).not.toHaveBeenCalled()

    card.destroy()
    shadow.destroy()
  })

  it('retries a failed clarification and restores the conversation controls', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'failed',
      messages: [],
      done: true,
    } satisfies ClarifyResponse)
    const retryClarification = vi.fn().mockResolvedValue({
      status: 'awaiting_response',
      messages: [{ role: 'assistant', content: 'What were you trying to export?' }],
      done: false,
    } satisfies ClarifyResponse)
    const getClarification = vi.fn().mockResolvedValue({
      status: 'failed',
      messages: [],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ startClarification, getClarification, retryClarification })
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalledWith('submission_123', 'submission-secret')
      expect(retryClarification).toHaveBeenCalledWith('submission_123', 'submission-secret')
    })

    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeNull()
      expect(shadow.root.querySelector('.mtb-clarify-input')).toBeTruthy()
      expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('What were you trying to export?')
    })

    card.destroy()
    shadow.destroy()
  })

  it('waits for confirmation when polling returns done=true', async () => {
    const getClarification = vi.fn().mockResolvedValueOnce({
      status: 'complete',
      messages: [{ role: 'assistant', content: 'Done' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card, onFinalize } = setupCard({ getClarification })
    await vi.waitFor(() => {
      expect(card).toBeTruthy()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    const sendFeedback = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!
    expect(sendFeedback).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()
    sendFeedback.click()
    expect(onFinalize).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('shows retry actions on startClarification error', async () => {
    const startClarification = vi.fn().mockRejectedValue(new Error('Network error'))

    const { shadow, card, onFinalize } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    const sendFeedback = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-fallback')!
    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()
    sendFeedback.click()
    expect(onFinalize).toHaveBeenCalledOnce()

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
    expect(startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret', '导出坏了')

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
      async (_id: string, _token: string, onDelta: (t: string) => void) => {
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
      expect(streamClarification).toHaveBeenCalledWith('submission_123', 'submission-secret', expect.any(Function))
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('What broke?')

    card.destroy()
    shadow.destroy()
  })

  it('waits for confirmation after streaming completes without polling', async () => {
    const streamClarification = vi.fn().mockResolvedValue({
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    })
    const getClarification = vi.fn()

    const { shadow, card, onFinalize } = setupCard({ streamClarification, getClarification } as never)
    await vi.waitFor(() => {
      expect(streamClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(2000)
    expect(getClarification).not.toHaveBeenCalled()
    const sendFeedback = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!
    expect(sendFeedback).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()
    sendFeedback.click()
    expect(onFinalize).toHaveBeenCalledOnce()

    card.destroy()
    shadow.destroy()
  })

  it('shows retry actions when polling exceeds the timeout with no reply', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'pending',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card, onFinalize } = setupCard({ getClarification })
    await vi.waitFor(() => {
      expect(card).toBeTruthy()
    })
    await vi.advanceTimersByTimeAsync(0)

    // Poll past the 45s deadline; the card should surface the failure instead of
    // presenting the conversation as successfully completed.
    await vi.advanceTimersByTimeAsync(48000)
    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()

    card.destroy()
    shadow.destroy()
  })

  it('shows retry actions when polling fails', async () => {
    const getClarification = vi.fn().mockRejectedValue(new Error('Network error'))

    const { shadow, card, onFinalize } = setupCard({ getClarification })
    await vi.advanceTimersByTimeAsync(2000)

    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()

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
