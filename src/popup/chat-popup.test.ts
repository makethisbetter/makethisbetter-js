import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatPopup } from './chat-popup'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'
import type { ClarifyStreamResult } from '../api/client'
import type { SubmissionSessionResponse } from '../types'

function makeSession(overrides?: Partial<SubmissionSessionResponse>): SubmissionSessionResponse {
  return { id: 'sub_1', token: 'tok', ai_clarify_available: true, ...overrides }
}

function makeResult(overrides?: Partial<ClarifyStreamResult>): ClarifyStreamResult {
  return {
    done: false,
    suggestions: [],
    messages: [{ role: 'assistant', content: 'What went wrong?' }],
    ...overrides,
  }
}

function mountPopup(overrides: Record<string, unknown> = {}) {
  const shadow = new ShadowContainer()
  const messages = getMessages('en')
  const defaults: Record<string, unknown> = {
    targetName: 'Button',
    x: 100,
    y: 100,
    messages,
    onSubmit: vi.fn().mockResolvedValue(makeSession()),
    onClarify: vi.fn().mockResolvedValue(makeResult()),
    onAnswer: vi.fn().mockResolvedValue(undefined),
    onFinalize: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
  }
  const opts = { ...defaults, ...overrides }
  const popup = new ChatPopup(shadow, opts as unknown as ConstructorParameters<typeof ChatPopup>[1])
  return { shadow, popup, opts }
}

describe('ChatPopup streaming', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows streaming bubble immediately on first delta, not after stream ends', async () => {
    let emitDelta!: (text: string) => void
    const onClarify = vi.fn((_id: string, _tok: string, onDelta: (d: string) => void) => {
      emitDelta = onDelta
      return new Promise<ClarifyStreamResult>(() => {})
    })
    const { shadow, popup } = mountPopup({ onClarify })
    popup.submit('test')

    await vi.waitFor(() => expect(onClarify).toHaveBeenCalled())

    expect(shadow.root.querySelector('.mtb-chat-bubble-ai')).toBeNull()

    emitDelta('Hello')

    expect(shadow.root.querySelector('.mtb-chat-bubble-ai')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-chat-bubble-ai')!.textContent).toBe('Hello')

    emitDelta(' world')
    expect(shadow.root.querySelector('.mtb-chat-bubble-ai')!.textContent).toBe('Hello world')

    popup.destroy()
    shadow.destroy()
  })

  it('skips streaming bubble when done:true and shows receipt directly', async () => {
    const onClarify = vi.fn().mockResolvedValue(makeResult({ done: true, messages: [] }))
    const { shadow, popup } = mountPopup({ onClarify })

    popup.submit('clear feedback')

    await vi.waitFor(() => {
      expect(shadow.root.querySelector('.mtb-chat-success')).toBeTruthy()
    })

    expect(shadow.root.querySelector('.mtb-chat-bubble-ai')).toBeNull()

    popup.destroy()
    shadow.destroy()
  })

  it('passes AbortSignal to onClarify', async () => {
    const onClarify = vi.fn((_id: string, _tok: string, _delta: unknown, signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return Promise.resolve(makeResult())
    })
    const { shadow, popup } = mountPopup({ onClarify })
    popup.submit('test')

    await vi.waitFor(() => expect(onClarify).toHaveBeenCalled())
    expect(onClarify.mock.calls[0][3]).toBeInstanceOf(AbortSignal)

    popup.destroy()
    shadow.destroy()
  })

  it('aborts the SSE stream when destroyed', async () => {
    let signal: AbortSignal | undefined
    const onClarify = vi.fn((_id: string, _tok: string, _delta: unknown, s: AbortSignal) => {
      signal = s
      return new Promise<ClarifyStreamResult>(() => {})
    })
    const { shadow, popup } = mountPopup({ onClarify })
    popup.submit('test')

    await vi.waitFor(() => expect(onClarify).toHaveBeenCalled())
    expect(signal?.aborted).toBe(false)

    popup.destroy()
    expect(signal?.aborted).toBe(true)

    shadow.destroy()
  })
})

describe('ChatPopup finalize failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows failure state in the receipt card', async () => {
    const onClarify = vi.fn().mockResolvedValue(makeResult({ done: true, messages: [] }))
    const { shadow, popup } = mountPopup({ onClarify })

    popup.submit('test')
    await vi.waitFor(() => expect(shadow.root.querySelector('.mtb-chat-success')).toBeTruthy())

    const retry = vi.fn()
    popup.showFinalizeFailure(retry)

    expect(shadow.root.querySelector('.mtb-chat-finalize-failure')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-chat-finalize-retry')).toBeTruthy()

    popup.destroy()
    shadow.destroy()
  })

  it('creates failure container when receipt does not exist yet', async () => {
    const { shadow, popup } = mountPopup()

    popup.showFinalizeFailure()

    expect(shadow.root.querySelector('.mtb-chat-finalize-failure')).toBeTruthy()
    expect(shadow.root.querySelector('.mtb-chat-finalize-retry')).toBeNull()

    popup.destroy()
    shadow.destroy()
  })

  it('restores receipt after showFinalizeSuccess', async () => {
    const onClarify = vi.fn().mockResolvedValue(makeResult({ done: true, messages: [] }))
    const { shadow, popup } = mountPopup({ onClarify })

    popup.submit('test')
    await vi.waitFor(() => expect(shadow.root.querySelector('.mtb-chat-success')).toBeTruthy())

    popup.showFinalizeFailure(vi.fn())
    expect(shadow.root.querySelector('.mtb-chat-finalize-failure')).toBeTruthy()

    popup.showFinalizeSuccess()
    expect(shadow.root.querySelector('.mtb-chat-finalize-failure')).toBeNull()
    expect(shadow.root.querySelector('.mtb-chat-success')).toBeTruthy()

    popup.destroy()
    shadow.destroy()
  })
})
