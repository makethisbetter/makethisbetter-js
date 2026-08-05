// Characterization net for the ClarifyCard conversation/session logic ahead of
// the conversation-state extraction (state machine out of the DOM class).
// Each test pins one class of legal behavior through the public surface only:
// constructor options, DOM inside the shadow root, the ApiClient collaborator
// (this class's network boundary), and the onFinalize/onSkip/onCancel
// callbacks. No test reads private fields — the refactor may rename all of
// them; these must stay green with zero assertion changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClarifyCard } from './clarify'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'
import type { ApiClient } from '../api/client'
import { ApiError } from '../api/client'
import type { ClarifyResponse, SubmissionSessionResponse } from '../types'

// The browser-targeted tsconfig has no Node types, but vitest runs on Node
// where `process` exists — declare just the two members the unhandled-rejection
// checks use.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void
}

// Minimal replica of the clarify.test.ts harness (not exported from there, and
// that file is being adapted concurrently — importing would couple the nets).
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
    ...cardOverrides,
  })

  return { shadow, card, onFinalize, apiClient, messages }
}

function typeAnswer(shadow: ShadowContainer, text: string): void {
  const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!
  input.value = text
  input.dispatchEvent(new Event('input'))
  shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-send')!.click()
}

function callOrder(fn: ReturnType<typeof vi.fn>): number {
  return fn.mock.invocationCallOrder[0]
}

describe('ClarifyCard session behavior (characterization)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    while (liveCards.length) liveCards.pop()!.destroy()
    while (liveShadows.length) liveShadows.pop()!.destroy()
    vi.useRealTimers()
  })

  // 1. The happy loop, end to end: the card mounts before the upload finishes,
  // adopts the session the upload produces, streams the AI question against
  // that session's credentials, delivers the reporter's answer, and finalizes
  // without a second click — in exactly that network order.
  it('adopts the uploaded session, converses, and finalizes in order', async () => {
    let resolveSession!: (s: SubmissionSessionResponse | null) => void
    const pending = new Promise<SubmissionSessionResponse | null>(r => { resolveSession = r })

    const streamClarification = vi.fn().mockResolvedValue({
      messages: [{ role: 'assistant', content: 'What broke exactly?' }],
      done: false,
    })
    const startClarification = vi.fn().mockResolvedValue({
      status: 'completed',
      messages: [
        { role: 'assistant', content: 'What broke exactly?' },
        { role: 'user', content: 'The export button does nothing' },
        { role: 'assistant', content: 'Got it, thanks.' },
      ],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, onFinalize } = setupCard(
      { streamClarification, startClarification } as never,
      { submissionSessionId: undefined, submissionToken: undefined, pendingSession: pending },
    )

    // Before the session exists there is nowhere to deliver a reply: the input
    // is closed and no clarify request has been made.
    const input = shadow.root.querySelector<HTMLTextAreaElement>('.mtb-clarify-input')!
    expect(input.disabled).toBe(true)
    expect(streamClarification).not.toHaveBeenCalled()

    resolveSession({ id: 'submission_9', token: 'tok-9', ai_clarify_available: true })
    await vi.waitFor(() => {
      expect(streamClarification).toHaveBeenCalledWith(
        'submission_9', 'tok-9', expect.any(Function), expect.any(AbortSignal),
      )
    })
    await vi.advanceTimersByTimeAsync(0)

    // The AI question renders and the conversation is open for the reporter.
    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('What broke exactly?')
    expect(input.disabled).toBe(false)

    typeAnswer(shadow, 'The export button does nothing')
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledWith(
        'submission_9', 'tok-9', 'The export button does nothing',
      )
    })
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })

    // Network order is the contract: question turn, then answer turn, then the
    // finalize the completed exchange triggers on its own.
    expect(callOrder(streamClarification)).toBeLessThan(callOrder(startClarification))
    expect(callOrder(startClarification)).toBeLessThan(callOrder(onFinalize))
    // A completed AI exchange never asks for a second click.
    expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeNull()
    // The reporter's answer stayed on screen through the hand-off.
    expect(shadow.root.querySelector('.mtb-clarify-user')?.textContent).toBe('The export button does nothing')
  })

  // 2a. An older server with no SSE endpoint (streamClarification throws) must
  // land the reporter in the same conversation the stream would have produced.
  it('reaches the same conversation outcome when only the polling path exists', async () => {
    const startClarification = vi.fn()
      .mockResolvedValueOnce({
        status: 'awaiting_response',
        messages: [{ role: 'assistant', content: 'Which page were you on?' }],
        done: false,
      } satisfies ClarifyResponse)
      .mockResolvedValueOnce({
        status: 'completed',
        messages: [
          { role: 'assistant', content: 'Which page were you on?' },
          { role: 'user', content: 'The billing page' },
          { role: 'assistant', content: 'Thanks!' },
        ],
        done: true,
      } satisfies ClarifyResponse)

    // The harness apiClient has no streamClarification at all — the SSE call
    // itself fails and the card must fall back without surfacing an error.
    const { shadow, onFinalize } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledWith('submission_123', 'submission-secret')
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeNull()
    expect(shadow.root.querySelector('.mtb-clarify-ai')?.textContent).toBe('Which page were you on?')

    typeAnswer(shadow, 'The billing page')
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })
  })

  // 2b. The two timing budgets, pinned together because they hand off: a
  // stream may stay silent 12s before the card hangs up and falls back, and
  // the polling that follows gets 45s of no-reply before failing.
  it('hangs up on a silent stream at 12s and gives polling up at 45s', async () => {
    const streamClarification = vi.fn().mockImplementation(
      (_id: string, _token: string, _onDelta: (t: string) => void, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
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

    const { shadow, onFinalize } = setupCard(
      { streamClarification, startClarification, getClarification } as never,
    )
    await vi.waitFor(() => {
      expect(streamClarification).toHaveBeenCalled()
    })

    // Just short of the silence deadline the stream is still trusted.
    await vi.advanceTimersByTimeAsync(11_000)
    expect(startClarification).not.toHaveBeenCalled()

    // At 12s of silence the card falls back to the POST + poll path.
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => {
      expect(startClarification).toHaveBeenCalledOnce()
    })

    // Polling runs, but a backend job that never answers cannot spin the card
    // forever: past the 45s deadline it becomes a retryable failure.
    await vi.advanceTimersByTimeAsync(46_000)
    expect(getClarification).toHaveBeenCalled()
    expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()

    // And a dead clarification never blocks the feedback itself.
    expect(shadow.root.querySelector('.mtb-clarify-fallback')).toBeTruthy()
  })

  // 3a. A failed clarification turn is not a failed feedback: the footer must
  // offer both a retry of the AI exchange and a way to just send.
  it('a failed clarify turn offers retry while the feedback stays sendable', async () => {
    const startClarification = vi.fn().mockRejectedValue(new Error('Network error'))

    const { shadow, onFinalize, messages } = setupCard({ startClarification })
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')).toBeTruthy()
    })

    expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.clarify.error)
    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-fallback')!.click()
    expect(onFinalize).toHaveBeenCalledOnce()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  // 3b. When the submission upload itself failed, nothing exists server-side:
  // no clarify call may be attempted, and the only recovery is re-submission.
  it('a failed upload offers re-submission, never a clarify call', async () => {
    const onRetrySubmission = vi.fn().mockResolvedValue({
      id: 'submission_2',
      token: 'tok-2',
      ai_clarify_available: true,
    } satisfies SubmissionSessionResponse)

    const { shadow, apiClient, messages } = setupCard(
      {},
      {
        submissionSessionId: undefined,
        submissionToken: undefined,
        pendingSession: Promise.resolve(null),
        onRetrySubmission,
      },
    )
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeTruthy()
    })

    expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.error.submit)
    expect(apiClient.startClarification).not.toHaveBeenCalled()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-retry')!.click()
    await vi.waitFor(() => {
      expect(onRetrySubmission).toHaveBeenCalledOnce()
      // The retried upload's session — not the dead one — drives the next turn.
      expect(apiClient.startClarification).toHaveBeenCalledWith('submission_2', 'tok-2')
    })
  })

  // 3c. A 409 on finalize is terminal: the server will never accept this
  // session again, so a Retry button could only loop the same error.
  it('a terminal 409 conflict ends the session with no retry loop', async () => {
    const onFinalize = vi.fn().mockRejectedValue(new ApiError(409))
    const startClarification = vi.fn().mockResolvedValue({
      status: 'completed',
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow, messages } = setupCard({ startClarification }, { onFinalize })
    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-clarify-error')?.textContent).toBe(messages.clarify.expired)
    })

    expect(shadow.root.querySelector('.mtb-clarify-retry')).toBeNull()
    expect(shadow.root.querySelector('.mtb-clarify-send-feedback')).toBeNull()

    // Nothing on the card — including dismissal — fires another doomed send.
    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onFinalize).toHaveBeenCalledOnce()
  })

  // 4. Skip is "send without answering": the card leaves the screen at once
  // while exactly one finalize continues in the background — a queued second
  // Enter must not find a listener to double it.
  it('global Enter skips: instant dismissal, one background finalize', async () => {
    const onFinalize = vi.fn(() => new Promise<void>(() => {}))
    const { shadow, apiClient } = setupCard({}, { onFinalize })
    await vi.waitFor(() => {
      expect(apiClient.startClarification).toHaveBeenCalled()
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    // Dismissal is synchronous; the finalize keeps running unattached.
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
    expect(onFinalize).toHaveBeenCalledOnce()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(onFinalize).toHaveBeenCalledOnce()
  })

  // 5a. X during the live-conversation family (session uploaded, nothing
  // sent): the reporter is backing out entirely, so the abandon path fires and
  // nothing may finalize — and the in-flight turn is hung up on.
  it('X on a live conversation abandons: cancel fires, nothing finalizes', async () => {
    let capturedSignal: AbortSignal | undefined
    const streamClarification = vi.fn().mockImplementation(
      (_id: string, _token: string, _onDelta: (t: string) => void, signal: AbortSignal) => {
        capturedSignal = signal
        return new Promise(() => {})
      },
    )
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const { shadow, onFinalize } = setupCard(
      { streamClarification } as never,
      { onCancel, onSkip },
    )
    await vi.waitFor(() => {
      expect(capturedSignal).toBeDefined()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSkip).not.toHaveBeenCalled()
    expect(onFinalize).not.toHaveBeenCalled()
    expect(capturedSignal!.aborted).toBe(true)
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  // 5b. X during the finalizing family: the send is on the wire and cannot be
  // taken back — X only dismisses, no abandon, no second finalize.
  it('X while finalizing dismisses only: no abandon, no double-send', async () => {
    const onFinalize = vi.fn(() => new Promise<void>(() => {}))
    const onCancel = vi.fn()
    const onSkip = vi.fn()
    const startClarification = vi.fn().mockResolvedValue({
      status: 'completed',
      messages: [{ role: 'assistant', content: 'All clear, thanks!' }],
      done: true,
    } satisfies ClarifyResponse)

    const { shadow } = setupCard({ startClarification }, { onFinalize, onCancel, onSkip })
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledOnce()
    })

    shadow.root.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()

    expect(onCancel).not.toHaveBeenCalled()
    expect(onSkip).toHaveBeenCalledOnce()
    expect(onFinalize).toHaveBeenCalledOnce()
    expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
  })

  // 6. Destroy mid-await: continuations landing after destruction must go
  // fully silent — no fallback request, no failure footer painted onto a
  // detached card, no unhandled rejection escaping the widget.
  it('destroy while the first turn is in flight silences its continuation', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    try {
      const streamClarification = vi.fn().mockImplementation(
        (_id: string, _token: string, _onDelta: (t: string) => void, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const { shadow, card, apiClient } = setupCard({ streamClarification } as never)
      await vi.waitFor(() => {
        expect(streamClarification).toHaveBeenCalled()
      })

      // destroy() aborts the stream; its rejection is the late continuation.
      card.destroy()
      await vi.advanceTimersByTimeAsync(60_000)

      expect(apiClient.startClarification).not.toHaveBeenCalled()
      expect(apiClient.getClarification).not.toHaveBeenCalled()
      expect(shadow.root.querySelector('.mtb-clarify')).toBeNull()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  // 6 (second await boundary). The session adoption await is the other place
  // destruction can cut in: a session that finishes uploading after the card
  // died must not start a conversation for a card that is gone.
  it('destroy while the session uploads never starts the conversation', async () => {
    let resolveSession!: (s: SubmissionSessionResponse | null) => void
    const pending = new Promise<SubmissionSessionResponse | null>(r => { resolveSession = r })
    const { card, apiClient } = setupCard(
      {},
      { submissionSessionId: undefined, submissionToken: undefined, pendingSession: pending },
    )

    card.destroy()
    resolveSession({ id: 'submission_9', token: 'tok-9', ai_clarify_available: true })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(apiClient.startClarification).not.toHaveBeenCalled()
  })
})
