import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubmissionLifecycle, SCREENSHOT_WAIT_MS } from './submission-lifecycle'
import { captureBaseScreenshot } from '../screenshot/capture'
import type { ApiClient } from '../api/client'
import type { SubmissionLifecycleDeps, SubmissionLifecycleHost } from './submission-lifecycle'

vi.mock('../screenshot/capture', () => ({
  bakeAnnotatedScreenshot: vi.fn(),
  captureBaseScreenshot: vi.fn(),
  warmFontEmbedCss: vi.fn().mockResolvedValue(undefined),
}))

describe('SubmissionLifecycle screenshot orchestration', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('starts the default screenshot while the Session request is still pending', async () => {
    let resolveSubmission!: (submission: {
      id: string
      token: string
      ai_clarify_available: boolean
    }) => void
    const submissionRequest = new Promise<{
      id: string
      token: string
      ai_clarify_available: boolean
    }>((resolve) => {
      resolveSubmission = resolve
    })
    vi.mocked(captureBaseScreenshot).mockResolvedValue(null)

    const createSubmissionSession = vi.fn().mockReturnValue(submissionRequest)
    const apiClient = {
      createSubmissionSession,
      resolveScreenshotResourceUrl: vi.fn(),
      uploadScreenshot: vi.fn(),
    } as unknown as ApiClient
    const lifecycle = buildLifecycle(apiClient)

    const started = lifecycle.start('Export is broken', null, undefined)
    await vi.waitFor(() => expect(createSubmissionSession).toHaveBeenCalledTimes(1))

    expect(captureBaseScreenshot).toHaveBeenCalledTimes(1)

    resolveSubmission({
      id: 'submission_1',
      token: 'secret',
      ai_clarify_available: false,
    })
    await started
  })

  it('waits for the Session only when screenshot proxy fallback is needed', async () => {
    let resolveSubmission!: (submission: {
      id: string
      token: string
      ai_clarify_available: boolean
    }) => void
    const submissionRequest = new Promise<{
      id: string
      token: string
      ai_clarify_available: boolean
    }>((resolve) => {
      resolveSubmission = resolve
    })
    const resolveScreenshotResourceUrl = vi.fn().mockResolvedValue('https://image-proxy.example.com/signed')
    vi.mocked(captureBaseScreenshot).mockImplementation(async (resolver) => {
      await resolver?.('https://cdn.example.com/photo.png', 'image/png')
      return null
    })

    const apiClient = {
      createSubmissionSession: vi.fn().mockReturnValue(submissionRequest),
      resolveScreenshotResourceUrl,
      uploadScreenshot: vi.fn(),
    } as unknown as ApiClient
    const lifecycle = buildLifecycle(apiClient)

    const started = lifecycle.start('Export is broken', null, undefined)
    await vi.waitFor(() => expect(captureBaseScreenshot).toHaveBeenCalledTimes(1))

    expect(resolveScreenshotResourceUrl).not.toHaveBeenCalled()

    resolveSubmission({
      id: 'submission_1',
      token: 'secret',
      ai_clarify_available: false,
    })
    await started
    await vi.waitFor(() => {
      expect(resolveScreenshotResourceUrl).toHaveBeenCalledWith(
        'submission_1',
        'secret',
        'https://cdn.example.com/photo.png',
        'image/png',
        expect.any(AbortSignal),
      )
    })
  })

  it('aborts the concurrent screenshot when Session creation fails', async () => {
    let captureSignal: AbortSignal | undefined
    vi.mocked(captureBaseScreenshot).mockImplementation((_resolver, signal) => {
      captureSignal = signal
      return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(null)))
    })
    const apiClient = {
      createSubmissionSession: vi.fn().mockRejectedValue(new Error('Session unavailable')),
      resolveScreenshotResourceUrl: vi.fn(),
      uploadScreenshot: vi.fn(),
    } as unknown as ApiClient
    const lifecycle = buildLifecycle(apiClient)

    await expect(lifecycle.start('Export is broken', null, undefined)).resolves.toBeNull()
    await new Promise(r => setTimeout(r, 0))

    if (captureSignal) {
      expect(captureSignal.aborted).toBe(true)
    } else {
      expect(captureBaseScreenshot).not.toHaveBeenCalled()
    }
  })

  it('aborts a stalled screenshot and finalizes after five seconds', async () => {
    let captureSignal: AbortSignal | undefined
    vi.mocked(captureBaseScreenshot).mockImplementation((_resolver, signal) => {
      captureSignal = signal
      return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(null)))
    })

    const finalizeSubmissionSession = vi.fn().mockResolvedValue({
      id: 'FB-1',
      status: 'received',
      project_id: 'project_1',
    })
    const apiClient = {
      createSubmissionSession: vi.fn().mockResolvedValue({
        id: 'submission_1',
        token: 'secret',
        ai_clarify_available: false,
      }),
      finalizeSubmissionSession,
      resolveScreenshotResourceUrl: vi.fn(),
      uploadScreenshot: vi.fn(),
    } as unknown as ApiClient
    const lifecycle = buildLifecycle(apiClient)

    await lifecycle.start('Export is broken', null, undefined)
    await new Promise(r => setTimeout(r, 0))
    vi.useFakeTimers()
    const finalized = lifecycle.finalize()

    await vi.advanceTimersByTimeAsync(SCREENSHOT_WAIT_MS - 1)
    expect(finalizeSubmissionSession).not.toHaveBeenCalled()
    expect(captureSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(captureSignal?.aborted).toBe(true)
    await vi.runAllTimersAsync()
    await finalized
    expect(finalizeSubmissionSession).toHaveBeenCalledWith('submission_1', 'secret')
  })
})

function buildLifecycle(apiClient: ApiClient): SubmissionLifecycle {
  const deps = {
    apiClient,
    consoleCollector: { getErrors: () => [] },
    breadcrumbCollector: { getBreadcrumbs: () => [] },
    brandColors: undefined,
    shadow: () => document.body.attachShadow({ mode: 'open' }),
    messages: () => ({}),
    user: () => undefined,
  } as unknown as SubmissionLifecycleDeps
  const host = {
    isBackground: () => false,
    onFinalizeFailure: vi.fn(),
    onReenterBackground: vi.fn(),
    onFinalized: vi.fn(),
  } satisfies SubmissionLifecycleHost

  return new SubmissionLifecycle(deps, host)
}
