import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClarifyCard } from './clarify'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'
import type { ApiClient } from '../api/client'
import { ApiError } from '../api/client'
import type { ClarifyResponse, SubmissionSessionResponse } from '../types'

function mockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    startClarification: vi.fn().mockResolvedValue({
      status: 'processing',
      messages: [{ role: 'assistant', content: 'Can you tell me more?' }],
      done: false,
    } satisfies ClarifyResponse),
    getClarification: vi.fn().mockResolvedValue({
      status: 'processing',
      messages: [{ role: 'assistant', content: 'Can you tell me more?' }],
      done: false,
    } satisfies ClarifyResponse),
    retryClarification: vi.fn().mockResolvedValue({
      status: 'processing',
      messages: [{ role: 'assistant', content: 'Can you tell me more?' }],
      done: false,
    } satisfies ClarifyResponse),
    ...overrides,
  } as unknown as ApiClient
}

// A failed assertion used to skip the inline card.destroy()/shadow.destroy()
// pair at the bottom of its test, leaking that card's timers and window
// listeners into every test after it. Constructions register here and
// afterEach tears them down unconditionally; destroy() is idempotent, so
// tests that destroy as part of their own scenario are unaffected.
const liveCards: ClarifyCard[] = []
const liveShadows: ShadowContainer[] = []

function newShadow(): ShadowContainer {
  const shadow = new ShadowContainer()
  liveShadows.push(shadow)
  return shadow
}

function newCard(
  shadow: ShadowContainer,
  options: ConstructorParameters<typeof ClarifyCard>[1],
): ClarifyCard {
  const card = new ClarifyCard(shadow, options)
  liveCards.push(card)
  return card
}

function setupCard(
  apiOverrides: Partial<ApiClient> = {},
  pos?: { x: number; y: number },
  cardOverrides: Partial<ConstructorParameters<typeof ClarifyCard>[1]> = {},
) {
  const shadow = newShadow()
  const onFinalize = vi.fn()
  const apiClient = mockApiClient(apiOverrides)
  const messages = getMessages('en')

  const card = newCard(shadow, {
    submissionSessionId: 'submission_123',
    submissionToken: 'submission-secret',
    apiClient,
    messages,
    onFinalize,
    x: pos?.x,
    y: pos?.y,
    ...cardOverrides,
  })

  return { shadow, card, onFinalize, apiClient, messages }
}

describe('ClarifyCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    while (liveCards.length) liveCards.pop()!.destroy()
    while (liveShadows.length) liveShadows.pop()!.destroy()
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
  })

  // The continuation is the common path — the popup hands over its element and
  // the class flips from .mtb-popup to .mtb-clarify, which is the moment the
  // sheet rules stop matching. Nothing else re-positions this element, so if
  // the card does not re-apply the sheet it ends up fixed with no offsets.
  describe('narrow viewport', () => {
    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true, writable: true })
    })

    function narrow(vpHeight = 852) {
      Object.defineProperty(window, 'innerWidth', { value: 393, configurable: true, writable: true })
      Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true, writable: true })
      Object.defineProperty(window, 'visualViewport', {
        value: { height: vpHeight, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
        configurable: true,
        writable: true,
      })
    }

    it('keeps a fresh card as a sheet instead of anchoring it to the pin', async () => {
      narrow()
      const { shadow, card, apiClient } = setupCard({}, { x: 200, y: 700 })
      await vi.waitFor(() => expect(apiClient.startClarification).toHaveBeenCalled())

      const el = shadow.root.querySelector<HTMLElement>('.mtb-clarify')!
      expect(el.style.left).toBe('')
      expect(el.style.top).toBe('')
    })

    it('re-applies the sheet to an inherited element', async () => {
      narrow()
      const shadow = newShadow()
      const element = shadow.el<HTMLDivElement>('div', 'mtb-popup')
      element.style.left = '40px'
      element.style.top = '60px'
      shadow.append(element)

      const apiClient = mockApiClient()
      const card = newCard(shadow, {
        submissionSessionId: 'submission_123',
        submissionToken: 'submission-secret',
        apiClient,
        messages: getMessages('en'),
        onFinalize: vi.fn(),
        element,
      })
      await vi.waitFor(() => expect(apiClient.startClarification).toHaveBeenCalled())

      expect(element.style.left).toBe('')
      expect(element.style.top).toBe('')
    })

    it('lifts an inherited element above an already-open keyboard', async () => {
      narrow(561)
      const shadow = newShadow()
      const element = shadow.el<HTMLDivElement>('div', 'mtb-popup')
      shadow.append(element)

      const apiClient = mockApiClient()
      const card = newCard(shadow, {
        submissionSessionId: 'submission_123',
        submissionToken: 'submission-secret',
        apiClient,
        messages: getMessages('en'),
        onFinalize: vi.fn(),
        element,
      })
      await vi.waitFor(() => expect(apiClient.startClarification).toHaveBeenCalled())

      expect(element.style.bottom).toBe('291px')
    })
  })

  it('reuses the current popup element without moving or replaying its entrance', async () => {
    const shadow = newShadow()
    const element = shadow.el<HTMLDivElement>('div', 'mtb-popup')
    element.style.left = '40px'
    element.style.top = '60px'
    shadow.append(element)

    const apiClient = mockApiClient()
    const card = newCard(shadow, {
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
    expect(shadow.root.activeElement).not.toBe(element.querySelector('.mtb-clarify-skip'))
  })

  it('renders header with skip button', async () => {
    const { shadow, card, messages, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    const skip = shadow.root.querySelector('.mtb-clarify-skip')
    expect(skip?.textContent).toBe(messages.clarify.skip)
    expect(shadow.root.querySelector('.mtb-clarify-icon path')?.getAttribute('d')).toBe('M21 2v6h-6')
  })

  it('anchors near the given position instead of a fixed corner', async () => {
    const { shadow, card } = setupCard({}, { x: 400, y: 300 })
    const el = shadow.root.querySelector<HTMLDivElement>('.mtb-clarify')!
    // Positioned via left/top near the point, not pinned to a corner.
    expect(el.style.left).toBe('412px')
    expect(el.style.top).toBe('312px')
    expect(el.style.right).toBe('')
    expect(el.style.bottom).toBe('')
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
  })

  it('leaves room for a left-side feedback tab', async () => {
    const shadow = newShadow()
    const card = newCard(shadow, {
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
  })

  it('renders the redesigned header title and subtitle', async () => {
    const { shadow, card, messages } = setupCard()
    expect(shadow.root.querySelector('.mtb-clarify-title')?.textContent).toBe(messages.clarify.title)
    expect(shadow.root.querySelector('.mtb-clarify-subtitle')?.textContent).toBe(messages.clarify.subtitle)
  })

  // The boundary the X pins: closing a live follow-up conversation is the
  // reporter deciding not to send at all. It routes to onCancel (the
  // controller's exitAll, which abandons the uploaded session) and must never
  // finalize — the explicit Skip button owns skip-and-send.
  it('header close cancels a live conversation without sending', async () => {
    const onCancel = vi.fn()
    const { shadow, onFinalize, messages, apiClient } = setupCard({}, undefined, { onCancel })
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    const close = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!
    expect(close.getAttribute('aria-label')).toBe(messages.clarify.cancel)
    expect(close.getAttribute('title')).toBe(messages.clarify.cancel)
    close.click()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onFinalize).not.toHaveBeenCalled()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  it('falls back to startClarification when streaming is unavailable', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret')
    })
  })

  it('renders messages from startClarification response', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
  })

  it('Skip & send closes immediately while onFinalize continues in the background', async () => {
    const onFinalize = vi.fn(() => new Promise<void>(() => {}))
    const shadow = newShadow()
    const apiClient = mockApiClient()
    newCard(shadow, {
      submissionSessionId: 'submission_123',
      submissionToken: 'submission-secret',
      apiClient,
      messages: getMessages('en'),
      onFinalize,
    })
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()
    expect(onFinalize).toHaveBeenCalledOnce()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  // Once finalization is in flight the send can no longer be taken back:
  // cancelling here would race the finalize (and the abandon's attempt bump
  // would drop its success), so X only dismisses the card like the Skip
  // path's dismissal — no abandon, no second finalize.
  it('header close during finalizing dismisses without cancelling or re-sending', async () => {
    const onFinalize = vi.fn(() => new Promise<void>(() => {}))
    const onSkip = vi.fn()
    const onCancel = vi.fn()
    const shadow = newShadow()
    const apiClient = mockApiClient({
      startClarification: vi.fn().mockResolvedValue({
        status: 'completed',
        messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
        done: true,
      } satisfies ClarifyResponse),
    })
    newCard(shadow, {
      submissionSessionId: 'submission_123',
      submissionToken: 'submission-secret',
      apiClient,
      messages: getMessages('en'),
      onFinalize,
      onSkip,
      onCancel,
    })
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })

    const close = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!
    // The busy-state disable sweeps every other button; X must stay usable so
    // the reporter is not locked in front of a spinner.
    expect(close.disabled).toBe(false)
    close.click()

    expect(onSkip).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onFinalize).toHaveBeenCalledOnce()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  it('Enter skips without focusing the skip button', async () => {
    const { shadow, onFinalize, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    expect(shadow.root.activeElement).not.toBe(shadow.root.querySelector('.mtb-clarify-skip'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(onFinalize).toHaveBeenCalledOnce()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  it('ignores the submit Enter but catches the next Enter immediately', () => {
    const initiatingKeydown = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    const { shadow, onFinalize } = setupCard({}, undefined, { initiatingKeydown })

    window.dispatchEvent(initiatingKeydown)
    expect(onFinalize).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(onFinalize).toHaveBeenCalledOnce()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  it('removes the keyboard listener after immediate destroy', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { shadow, card } = setupCard()

    card.destroy()

    expect(addEventListener.mock.calls.some(([type]) => type === 'keydown')).toBe(true)
    expect(removeEventListener.mock.calls.some(([type]) => type === 'keydown')).toBe(true)
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
  })

  it('does not send when input is empty or whitespace-only', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
  })

  it('sends user message via apiClient', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'processing',
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
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
    expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeNull()
  })

  it('keeps loading on the send button through final submission', async () => {
    let resolveAnswer!: (value: ClarifyResponse) => void
    const answer = new Promise<ClarifyResponse>((resolve) => { resolveAnswer = resolve })
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'awaiting_response',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockReturnValueOnce(answer)
    const getClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'processing',
        messages: [
          { role: 'assistant', content: 'Tell me more' },
          { role: 'user', content: 'Button does nothing' },
          { role: 'assistant', content: 'Thanks, submitting now' },
        ],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'completed',
        messages: [
          { role: 'assistant', content: 'Tell me more' },
          { role: 'user', content: 'Button does nothing' },
          { role: 'assistant', content: 'Thanks, submitting now' },
        ],
        done: true,
      } satisfies ClarifyResponse)

    const { shadow, card, messages, onFinalize } = setupCard({ startClarification, getClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!
    const sendBtn = shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!
    input.value = 'Button does nothing'
    input.dispatchEvent(new Event('input'))
    sendBtn.click()

    expect(sendBtn.getAttribute('aria-label')).toBe(messages.clarify.send)
    expect(sendBtn.getAttribute('aria-busy')).toBe('true')
    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()

    resolveAnswer({
      status: 'processing',
      messages: [
        { role: 'assistant', content: 'Tell me more' },
        { role: 'user', content: 'Button does nothing' },
      ],
      done: false,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(sendBtn.getAttribute('aria-busy')).toBe('true')
    expect(input.disabled).toBe(true)
    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalledOnce()
    })
    expect(sendBtn.getAttribute('aria-busy')).toBe('true')
    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    expect(shadow.root.querySelectorAll('.mtb-clarify-ai')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
    expect(sendBtn.getAttribute('aria-busy')).toBe('true')
    expect(shadow.root.querySelectorAll('.mtb-clarify-ai')).toHaveLength(1)
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
    expect(shadow.root.querySelector('.mtb-clarify-send')?.getAttribute('aria-busy')).toBeNull()
  })

  it('Enter from the shadow textarea sends the message without finalizing', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'processing',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'processing',
        messages: [],
        done: false,
      } satisfies ClarifyResponse)

    const { shadow, card, onFinalize } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })
    await vi.advanceTimersByTimeAsync(0)

    const input = shadow.root.querySelector<HTMLInputElement>('.mtb-clarify-input')!
    input.value = 'Help me'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))

    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledTimes(2)
    })
    expect(startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret', 'Help me')
    expect(onFinalize).not.toHaveBeenCalled()
  })

  it('clears input after sending', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'processing',
        messages: [{ role: 'assistant', content: 'Go on' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'processing',
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
  })

  it('starts polling after non-done response', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
  })

  it('submits immediately when an AI reply completes clarification', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'completed',
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, card, onFinalize } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('All clear, thanks!')
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
    expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeNull()
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
  })

  // awaiting_response means the assistant already asked its question and the
  // server is waiting on the reporter. Retrying used to match no branch at all,
  // so the card started a 45s poll for a state only a human reply can move, then
  // showed a failure card for a perfectly healthy session.
  it('hands the card back to the reporter when the server is awaiting their response', async () => {
    const startClarification = vi.fn().mockRejectedValue(new Error('Network error'))
    const getClarification = vi.fn().mockResolvedValue({
      status: 'awaiting_response',
      messages: [{ role: 'assistant', content: 'Which button did you press?' }],
      done: false,
    } satisfies ClarifyResponse)
    const retryClarification = vi.fn()

    const { shadow, card } = setupCard({ startClarification, getClarification, retryClarification })
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()

    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('Which button did you press?')
    })
    const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!
    expect(input.disabled).toBe(false)
    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    // Neither endpoint should be re-driven: the turn already happened.
    expect(retryClarification).not.toHaveBeenCalled()
    expect(startClarification).toHaveBeenCalledOnce()

    // And no poll loop was armed, so the 45s deadline can never fire a failure.
    const callsAfterRetry = getClarification.mock.calls.length
    await vi.advanceTimersByTimeAsync(50_000)
    expect(getClarification.mock.calls.length).toBe(callsAfterRetry)
    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeNull()
  })

  // processing means a job is already running for this session; starting another
  // turn would duplicate it, so the card just waits via the poll loop.
  it('waits via polling instead of starting a duplicate turn while processing', async () => {
    const startClarification = vi.fn().mockRejectedValueOnce(new Error('Network error'))
    const getClarification = vi.fn()
      .mockResolvedValueOnce({ status: 'processing', messages: [], done: false } satisfies ClarifyResponse)
      .mockResolvedValue({
        status: 'completed',
        messages: [{ role: 'assistant', content: 'Got it, thanks.' }],
        done: true,
      } satisfies ClarifyResponse)
    const retryClarification = vi.fn()

    const { shadow, card, onFinalize } = setupCard({ startClarification, getClarification, retryClarification })
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()
    await vi.waitFor(() => {
      expect(getClarification).toHaveBeenCalled()
    })

    expect(retryClarification).not.toHaveBeenCalled()
    expect(startClarification).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
  })

  it('restarts an idle clarification after the initial request never reached the server', async () => {
    const startClarification = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        status: 'processing',
        messages: [],
        done: false,
      } satisfies ClarifyResponse)
    const getClarification = vi.fn().mockResolvedValue({
      status: 'idle',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)
    const retryClarification = vi.fn()

    const { shadow, card } = setupCard({ startClarification, getClarification, retryClarification })
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()

    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledTimes(2)
    })
    expect(startClarification).toHaveBeenLastCalledWith('submission_123', 'submission-secret')
    expect(retryClarification).not.toHaveBeenCalled()
  })

  it('submits when polling returns done=true', async () => {
    const getClarification = vi.fn().mockResolvedValueOnce({
      status: 'completed',
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

    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
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
  })

  it('destroy removes element from shadow root', async () => {
    const { shadow, card, apiClient } = setupCard()
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    expect(shadow.root.querySelector('.mtb-clarify')).toBeTruthy()
    card.destroy()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  it('ignores Enter during IME composition', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'processing',
        messages: [{ role: 'assistant', content: 'Tell me more' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'processing',
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
  })

  it('keeps thinking indicator while waiting for the AI reply', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'processing',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)
    const getClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
  })

  it('removes thinking indicator when the AI reply arrives', async () => {
    const startClarification = vi.fn().mockResolvedValue({
      status: 'processing',
      messages: [],
      done: false,
    } satisfies ClarifyResponse)
    const getClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
      expect(streamClarification).toHaveBeenCalledWith(
        'submission_123',
        'submission-secret',
        expect.any(Function),
        expect.any(AbortSignal),
      )
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('What broke?')
  })

  // Closing the card is the reporter saying they are done. The connection has
  // to hear that too, rather than reading a reply into a card that is gone.
  it('hangs up on an in-flight stream when the card is destroyed', async () => {
    let capturedSignal: AbortSignal | undefined
    const streamClarification = vi.fn().mockImplementation(
      (_id: string, _token: string, _onDelta: (t: string) => void, signal: AbortSignal) => {
        capturedSignal = signal
        return new Promise(() => {})
      },
    )

    const { shadow, card } = setupCard({ streamClarification } as never)
    await vi.waitFor(() => {
      expect(capturedSignal).toBeDefined()
    })
    expect(capturedSignal!.aborted).toBe(false)

    card.destroy()

    expect(capturedSignal!.aborted).toBe(true)
  })

  it('hangs up on an in-flight stream when the reporter skips', async () => {
    let capturedSignal: AbortSignal | undefined
    const streamClarification = vi.fn().mockImplementation(
      (_id: string, _token: string, _onDelta: (t: string) => void, signal: AbortSignal) => {
        capturedSignal = signal
        return new Promise(() => {})
      },
    )

    const { shadow, card, onFinalize } = setupCard({ streamClarification } as never)
    await vi.waitFor(() => {
      expect(capturedSignal).toBeDefined()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()

    expect(capturedSignal!.aborted).toBe(true)
    expect(onFinalize).toHaveBeenCalledOnce()
  })

  it('submits after streaming completes without polling', async () => {
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
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
  })

  it('shows retry actions when polling exceeds the timeout with no reply', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
  })

  it('shows retry actions when polling fails', async () => {
    const getClarification = vi.fn().mockRejectedValue(new Error('Network error'))

    const { shadow, card, onFinalize } = setupCard({ getClarification })
    await vi.advanceTimersByTimeAsync(2000)

    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()
  })

  it('stops polling on destroy', async () => {
    const getClarification = vi.fn().mockResolvedValue({
      status: 'processing',
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
  })
  // The card now mounts before the submission session exists: the reporter is
  // dropped straight into the conversation with a thinking bubble while the
  // screenshot upload runs behind it.
  describe('pending session', () => {
    function setupPendingCard(
      pending: Promise<SubmissionSessionResponse | null>,
      overrides: {
        api?: Partial<ApiClient>
        onRetrySubmission?: () => Promise<SubmissionSessionResponse | null>
        onCancel?: () => void
      } = {},
    ) {
      const shadow = newShadow()
      const onFinalize = vi.fn()
      const onCancel = overrides.onCancel ?? vi.fn()
      const apiClient = mockApiClient(overrides.api ?? {})
      const card = newCard(shadow, {
        pendingSession: pending,
        onRetrySubmission: overrides.onRetrySubmission,
        apiClient,
        messages: getMessages('en'),
        onFinalize,
        onCancel,
      })
      return { shadow, card, onFinalize, onCancel, apiClient }
    }

    it('shows the thinking bubble and a closed input while the session uploads', async () => {
      let resolveSession!: (s: SubmissionSessionResponse | null) => void
      const pending = new Promise<SubmissionSessionResponse | null>(r => { resolveSession = r })
      const { shadow, card, apiClient } = setupPendingCard(pending)

      expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeTruthy()
      expect(shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!.disabled).toBe(true)
      expect(apiClient.startClarification).not.toHaveBeenCalled()

      resolveSession({ id: 'submission_9', token: 'tok', ai_clarify_available: true })
      await vi.waitFor(() => {
        expect(apiClient.startClarification).toHaveBeenCalledWith('submission_9', 'tok')
      })
      expect(shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!.disabled).toBe(false)
    })

    it('closes immediately and skips AI while the session is still uploading', async () => {
      let resolveSession!: (s: SubmissionSessionResponse | null) => void
      const pending = new Promise<SubmissionSessionResponse | null>(r => { resolveSession = r })
      const { shadow, onFinalize, apiClient } = setupPendingCard(pending)

      await vi.advanceTimersByTimeAsync(0)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
      expect(onFinalize).toHaveBeenCalledOnce()
      expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()

      resolveSession({ id: 'submission_9', token: 'tok', ai_clarify_available: true })
      await vi.advanceTimersByTimeAsync(0)
      expect(apiClient.startClarification).not.toHaveBeenCalled()
    })

    it('goes straight to Send feedback when AI clarify is unavailable', async () => {
      const pending = Promise.resolve({ id: 'submission_9', token: 'tok', ai_clarify_available: false })
      const { shadow, card, apiClient } = setupPendingCard(pending)

      await vi.waitFor(() => {
        expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeTruthy()
      })
      expect(apiClient.startClarification).not.toHaveBeenCalled()
      expect(shadow.root.querySelector('.mtb-clarify-thinking')).toBeNull()
    })

    it('offers a retry that re-runs the whole submission when the upload fails', async () => {
      const onRetrySubmission = vi.fn().mockResolvedValue({
        id: 'submission_9',
        token: 'tok',
        ai_clarify_available: true,
      })
      const { shadow, card, apiClient } = setupPendingCard(Promise.resolve(null), { onRetrySubmission })

      await vi.waitFor(() => {
        expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
      })
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
      expect(apiClient.startClarification).not.toHaveBeenCalled()

      shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()
      await vi.waitFor(() => {
        expect(onRetrySubmission).toHaveBeenCalledOnce()
        expect(apiClient.startClarification).toHaveBeenCalledWith('submission_9', 'tok')
      })
    })

    it('header close dismisses instead of finalizing after the upload failed', async () => {
      const onCancel = vi.fn()
      const { shadow, card, onFinalize } = setupPendingCard(Promise.resolve(null), { onCancel })

      await vi.waitFor(() => {
        expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
      })
      shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()

      expect(onCancel).toHaveBeenCalledOnce()
      expect(onFinalize).not.toHaveBeenCalled()
    })
  })

  it('falls back to polling when the stream stays silent past the deadline', async () => {
    const streamClarification = vi.fn().mockImplementation(
      (_id: string, _token: string, _onDelta: (t: string) => void, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const startClarification = vi.fn().mockResolvedValue({
      status: 'awaiting_response',
      messages: [{ role: 'assistant', content: 'What broke?' }],
      done: false,
    } satisfies ClarifyResponse)

    const { shadow, card } = setupCard({ streamClarification, startClarification } as never)
    await vi.waitFor(() => {
      expect(streamClarification).toHaveBeenCalled()
    })
    expect(startClarification).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(12000)
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalled()
    })
  })

  describe('finalize failures', () => {
    function setupDoneCard(onFinalize: () => Promise<void>) {
      const shadow = newShadow()
      const apiClient = mockApiClient({
        startClarification: vi.fn().mockResolvedValue({
          status: 'completed',
          messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
          done: true,
        } satisfies ClarifyResponse),
      })
      const card = newCard(shadow, {
        submissionSessionId: 'submission_123',
        submissionToken: 'submission-secret',
        apiClient,
        messages: getMessages('en'),
        onFinalize,
      })
      return { shadow, card, messages: getMessages('en') }
    }

    // The server answers 409 once the session is no longer active for submission
    // (e.g. it expired past its retention window during a long clarify chat).
    // fetchWithRetry correctly does not retry 4xx, so a Retry button here can only
    // ever reproduce the same error.
    it('offers no Retry when the server reports a terminal conflict', async () => {
      const onFinalize = vi.fn().mockRejectedValue(new ApiError(409))
      const { shadow, card, messages } = setupDoneCard(onFinalize)

      await vi.waitFor(() => {
        expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
      })
      expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.clarify.expired)
      expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeNull()
      expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeNull()
      expect(onFinalize).toHaveBeenCalledOnce()
    })

    it('still offers Retry for a transient finalize failure', async () => {
      const onFinalize = vi.fn().mockRejectedValue(new Error('Network error'))
      const { shadow, card, messages } = setupDoneCard(onFinalize)

      await vi.waitFor(() => {
        expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
      })
      expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.error.submit)

      shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()
      await vi.waitFor(() => {
        expect(onFinalize).toHaveBeenCalledTimes(2)
      })
    })

    it('does not re-request after a terminal conflict', async () => {
      const onFinalize = vi.fn().mockRejectedValue(new ApiError(409))
      const { shadow, card } = setupDoneCard(onFinalize)

      await vi.waitFor(() => {
        expect(onFinalize).toHaveBeenCalledOnce()
      })

      // The header close dismisses an unrecoverable card; it must not fire
      // another doomed finalize request.
      shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()
      await vi.advanceTimersByTimeAsync(100)
      expect(onFinalize).toHaveBeenCalledOnce()
      expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
    })
  })

  describe('accessibility', () => {
    it('announces itself as a modal dialog', async () => {
      const { shadow, card, apiClient, messages } = setupCard()
      await vi.waitFor(() => expect(apiClient.startClarification).toHaveBeenCalled())

      const el = shadow.root.querySelector('.mtb-clarify')!
      expect(el.getAttribute('role')).toBe('dialog')
      expect(el.getAttribute('aria-modal')).toBe('true')
      expect(el.getAttribute('aria-label')).toBe(messages.clarify.title)
    })

    it('Tab on the last control wraps back to the first', async () => {
      const { shadow, card, apiClient } = setupCard()
      await vi.waitFor(() => expect(apiClient.startClarification).toHaveBeenCalled())

      const el = shadow.root.querySelector<HTMLElement>('.mtb-clarify')!
      // The send button is disabled while the input is empty, so skip is the
      // last tabbable control.
      const first = shadow.root.querySelector<HTMLElement>('.mtb-clarify-close')!
      const last = shadow.root.querySelector<HTMLElement>('.mtb-clarify-skip')!

      last.focus()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      el.dispatchEvent(tab)

      expect(tab.defaultPrevented).toBe(true)
      expect(shadow.root.activeElement ?? document.activeElement).toBe(first)
    })

    it('returns focus to the opener after destroy', async () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { shadow, card, apiClient } = setupCard()
      await vi.waitFor(() => expect(apiClient.startClarification).toHaveBeenCalled())
      card.destroy()

      expect(document.activeElement).toBe(opener)

      opener.remove()
    })
  })
})
