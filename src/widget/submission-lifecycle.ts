import { bakeAnnotatedScreenshot, captureBaseScreenshot, warmFontEmbedCss } from '../screenshot/capture'
import type { BaseScreenshot } from '../screenshot/capture'
import { collectSessionRecordings } from '../context/session-recordings'
import { collectPageContext } from '../context/collector'
import { buildPayload } from './payload'
import { getAnonId, getStoredReporterEmail } from './anon-id'
import type { ApiClient } from '../api/client'
import type { ConsoleErrorCollector } from '../context/console'
import type { BreadcrumbCollector } from '../context/breadcrumbs'
import type { ShadowContainer } from './shadow'
import type { RecordingResult } from './recording-manager'
import type { WidgetBrandColors } from './brand-colors'
import type { getMessages } from '../i18n'
import type { MakeThisBetterConfig, Annotation, SubmissionSessionResponse, FeedbackResponse } from '../types'

const MIN_FINALIZE_LOADING_MS = 300
export const IDLE_CAPTURE_MS = 900
export const SCREENSHOT_WAIT_MS = 5_000

/**
 * Mode/UI transitions the lifecycle needs from its owner. The controller owns
 * mode and the launcher tab; the lifecycle only reports when a submission
 * outcome forces a transition, so "which UI is on screen" stays decided in one
 * place.
 */
export interface SubmissionLifecycleHost {
  /** True once the conversation has transitioned to its final receipt state. */
  isBackground(): boolean
  /** Replace the current conversation receipt with its retryable failure state. */
  onFinalizeFailure(onRetry?: () => void): void
  /** Return to the background-finalizing state ahead of a retry. */
  onReenterBackground(): void
  /** A finalize completed: hand off the feedback and show success. */
  onFinalized(feedback: FeedbackResponse, submission: SubmissionSessionResponse): void
}

/**
 * Everything the submission pipeline reads from the widget. Getters where the
 * value can change after construction (locale swaps messages; shadow only
 * exists once startup succeeded).
 */
export interface SubmissionLifecycleDeps {
  apiClient: ApiClient
  consoleCollector: ConsoleErrorCollector
  breadcrumbCollector: BreadcrumbCollector
  brandColors: WidgetBrandColors | undefined
  shadow: () => ShadowContainer
  messages: () => ReturnType<typeof getMessages>
  user: () => MakeThisBetterConfig['user']
}

/**
 * The submission concurrency state machine: attempt versioning, stale-request
 * abandonment, the foreground/background finalize dual path, and the failure
 * card's retry loop. Extracted so the controller's mode/UI orchestration and
 * this bookkeeping cannot silently interleave.
 */
export class SubmissionLifecycle {
  private activeSubmission: SubmissionSessionResponse | null = null
  private pendingSubmissionRequest: Promise<SubmissionSessionResponse | null> | null = null
  private submissionAttempt = 0
  private pendingScreenshotTask: Promise<void> | null = null
  private screenshotAbortController: AbortController | null = null
  private pendingBaseCapture: Promise<BaseScreenshot | null> | null = null
  private idleCaptureTimer: ReturnType<typeof setTimeout> | null = null
  private screenshotSession: Promise<SubmissionSessionResponse | null> | null = null
  private screenshotSessionReady: Promise<void> | null = null
  private resolveScreenshotSessionReady: (() => void) | null = null
  private screenshotEnabled = true

  constructor(
    private deps: SubmissionLifecycleDeps,
    private host: SubmissionLifecycleHost,
  ) {}

  /**
   * What the note surface must render. Reading it back rather than assuming
   * the default is what keeps the checkbox from claiming a screenshot is
   * attached while this object has already been told otherwise — the popup is
   * remounted mid-session (record mode returns through it), so "freshly opened"
   * does not imply "freshly consented".
   */
  isScreenshotEnabled(): boolean {
    return this.screenshotEnabled
  }

  /**
   * Back to the default for a fresh report. Unlike setScreenshotEnabled(true)
   * this starts no capture: the widget is idle at both call sites, and
   * rasterizing a page nobody is annotating would be work done for a report
   * that may never be written.
   */
  resetScreenshotConsent(): void {
    this.screenshotEnabled = true
  }

  /**
   * Consent, as reported by the note surface's checkbox.
   *
   * Turning it off prevents capture at submit. Turning it back on warms the
   * lazy screenshot dependency while the reporter is still composing.
   */
  setScreenshotEnabled(enabled: boolean): void {
    this.screenshotEnabled = enabled
    if (enabled) {
      this.warmScreenshotDeps()
      return
    }
    this.clearIdleCaptureTimer()
    this.screenshotAbortController?.abort()
    this.screenshotAbortController = null
    this.pendingBaseCapture = null
  }

  // Load the screenshot dependency and font CSS ahead of submit. Bitmap capture
  // starts alongside Session creation; only cross-origin fallback waits for it.
  warmScreenshotDeps(): void {
    if (!this.screenshotEnabled) return
    void warmFontEmbedCss()
  }

  // Preserve the viewport where the first annotation was made without
  // rasterizing while the reporter is actively typing. Cross-origin resource
  // resolution can wait for Session credentials without changing that frame.
  beginBaseCapture(): void {
    if (!this.screenshotEnabled || this.pendingBaseCapture) return
    this.warmScreenshotDeps()
    this.clearIdleCaptureTimer()
    this.idleCaptureTimer = setTimeout(() => {
      this.idleCaptureTimer = null
      const controller = new AbortController()
      this.screenshotAbortController?.abort()
      this.screenshotAbortController = controller
      const sessionReady = this.ensureScreenshotSessionReady()
      this.pendingBaseCapture = captureBaseScreenshot(async (resourceUrl, contentType) => {
        await Promise.race([sessionReady, waitForAbort(controller.signal)])
        if (controller.signal.aborted) return undefined
        const submission = await this.screenshotSession
        if (!submission || controller.signal.aborted) return undefined
        return this.deps.apiClient.resolveScreenshotResourceUrl(
          submission.id,
          submission.token,
          resourceUrl,
          contentType,
          controller.signal,
        )
      }, controller.signal)
    }, IDLE_CAPTURE_MS)
  }

  private clearIdleCaptureTimer(): void {
    if (this.idleCaptureTimer === null) return
    clearTimeout(this.idleCaptureTimer)
    this.idleCaptureTimer = null
  }

  private ensureScreenshotSessionReady(): Promise<void> {
    this.screenshotSessionReady ??= new Promise<void>((resolve) => {
      this.resolveScreenshotSessionReady = resolve
    })
    return this.screenshotSessionReady
  }

  start(
    description: string,
    annotation: Annotation | null,
    recording: RecordingResult | undefined,
  ): Promise<SubmissionSessionResponse | null> {
    const submissionAttempt = ++this.submissionAttempt
    const request = this.createSubmission(description, annotation, recording, submissionAttempt)
    this.pendingSubmissionRequest = request
    return request
  }

  private async createSubmission(
    description: string,
    annotation: Annotation | null,
    recording: RecordingResult | undefined,
    submissionAttempt: number,
  ): Promise<SubmissionSessionResponse | null> {
    await waitForPaint()
    if (submissionAttempt !== this.submissionAttempt) return null
    const pageContext = collectPageContext()
    const sessionRecordings = await collectSessionRecordings()

    const payload = buildPayload({
      description,
      pageContext,
      consoleErrors: this.deps.consoleCollector.getErrors(),
      annotation,
      user: this.deps.user(),
      recording,
      anonId: getAnonId(),
      anonEmail: getStoredReporterEmail(),
      breadcrumbs: this.deps.breadcrumbCollector.getBreadcrumbs(),
      sessionRecordings: Object.keys(sessionRecordings).length > 0 ? sessionRecordings : undefined,
    })

    // Create the Session and capture concurrently. Directly readable resources
    // can finish without the Session; only proxy fallback and upload await it.
    let submissionRequest: Promise<SubmissionSessionResponse>
    try {
      submissionRequest = this.deps.apiClient.createSubmissionSession(payload, null)
    } catch {
      return null
    }

    this.clearIdleCaptureTimer()
    this.screenshotSession = submissionRequest.catch(() => null)
    this.resolveScreenshotSessionReady?.()

    let screenshotController: AbortController | null = null
    if (this.screenshotEnabled) {
      const controller = this.screenshotAbortController ?? new AbortController()
      screenshotController = controller
      this.screenshotAbortController = controller
      const baseCapture = this.pendingBaseCapture
      const screenshotTask = (async () => {
        // Wait for the session response before starting the heavy capture.
        // Both this task and the main path await the same promise; the main
        // path's await was registered first, so its microtask runs first —
        // returning the submission and letting onClarify fire before toJpeg
        // blocks the main thread.
        const submission = await this.screenshotSession
        if (!submission || controller.signal.aborted || submissionAttempt !== this.submissionAttempt) return
        try {
          const resolver = async (resourceUrl: string, contentType?: string) => {
            if (controller.signal.aborted || submissionAttempt !== this.submissionAttempt) return undefined
            return this.deps.apiClient.resolveScreenshotResourceUrl(
              submission.id,
              submission.token,
              resourceUrl,
              contentType,
              controller.signal,
            )
          }
          const base = baseCapture
            ? await baseCapture
            : await captureBaseScreenshot(resolver, controller.signal)
          if (controller.signal.aborted || submissionAttempt !== this.submissionAttempt || !base) return
          const screenshot = await bakeAnnotatedScreenshot(base, annotation ? [annotation] : [], this.deps.brandColors)
          if (controller.signal.aborted || submissionAttempt !== this.submissionAttempt || !screenshot) return
          await this.deps.apiClient.uploadScreenshot(submission.id, submission.token, screenshot, controller.signal)
        } catch { /* screenshot is best-effort */ }
      })()
      const trackedTask = screenshotTask.finally(() => {
        if (this.pendingScreenshotTask === trackedTask) this.pendingScreenshotTask = null
        if (this.screenshotAbortController === controller) this.screenshotAbortController = null
        if (this.pendingBaseCapture === baseCapture) this.pendingBaseCapture = null
        this.screenshotSession = null
        this.screenshotSessionReady = null
        this.resolveScreenshotSessionReady = null
      })
      this.pendingScreenshotTask = trackedTask
    }

    let submission: SubmissionSessionResponse
    try {
      submission = await submissionRequest
      if (submissionAttempt !== this.submissionAttempt) {
        screenshotController?.abort()
        await this.deps.apiClient.abandonSubmissionSession(submission.id, submission.token).catch(() => {})
        return null
      }
      this.activeSubmission = submission
    } catch {
      screenshotController?.abort()
      return null
    }

    return submission
  }

  async finalize(): Promise<void> {
    const submissionAttempt = this.submissionAttempt
    // Consent is per submission and this one is decided — its screenshot was
    // captured (or declined) at session creation. Resetting here, when the
    // receipt renders, rather than when the finalize round trip lands, means a
    // reporter who starts their next report immediately gets a fresh default
    // instead of inheriting a decline through the in-flight window.
    this.resetScreenshotConsent()
    // The conversation has become a receipt on the skip path. A finalization
    // failure replaces that receipt with an in-card retry state.
    const background = this.host.isBackground()
    // Finalize can be asked for (skip button) while the session upload is still
    // in flight — wait for it rather than failing a healthy submission.
    const submission = this.activeSubmission ?? await (this.pendingSubmissionRequest ?? Promise.resolve(null))
    if (submissionAttempt !== this.submissionAttempt) return
    if (!submission) {
      if (background) return this.showFinalizeFailure({ canRetry: false })
      throw new Error('No active submission session')
    }

    await this.waitForScreenshot()
    if (submissionAttempt !== this.submissionAttempt) return

    // The loading floor protects the clarify card's busy state; on the
    // background path the card is gone, so waiting would only delay the result.
    const minimumLoading = background
      ? Promise.resolve()
      : new Promise<void>((resolve) => setTimeout(resolve, MIN_FINALIZE_LOADING_MS))
    let feedback: FeedbackResponse
    try {
      feedback = await this.deps.apiClient.finalizeSubmissionSession(submission.id, submission.token)
    } catch (error) {
      if (background) return this.showFinalizeFailure({ canRetry: true })
      throw error
    }
    await Promise.all([minimumLoading, waitForPaint()])
    if (submissionAttempt !== this.submissionAttempt || this.activeSubmission !== submission) return

    this.activeSubmission = null
    this.pendingSubmissionRequest = null
    this.host.onFinalized(feedback, submission)
  }

  private async waitForScreenshot(): Promise<void> {
    const task = this.pendingScreenshotTask
    if (!task) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = await Promise.race([
      task.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), SCREENSHOT_WAIT_MS)
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (!completed) {
      this.screenshotAbortController?.abort()
      if (this.pendingScreenshotTask === task) this.pendingScreenshotTask = null
    }
  }

  private showFinalizeFailure(options: {canRetry: boolean}): void {
    this.host.onFinalizeFailure(options.canRetry ? () => this.retryBackgroundFinalization() : undefined)
  }

  private retryBackgroundFinalization(): void {
    // Re-enter the background state so another failure comes back to this card
    // rather than throwing with nothing on screen.
    this.host.onReenterBackground()
    void this.finalize().catch(() => this.showFinalizeFailure({canRetry: true}))
  }

  /**
   * Invalidate every in-flight attempt and abandon what already reached the
   * server. Both exit and destroy route through here.
   */
  abandon(): void {
    this.submissionAttempt += 1
    this.clearIdleCaptureTimer()
    this.screenshotAbortController?.abort()
    this.screenshotAbortController = null
    this.pendingScreenshotTask = null
    this.pendingBaseCapture = null
    this.screenshotSession = null
    this.resolveScreenshotSessionReady?.()
    this.screenshotSessionReady = null
    this.resolveScreenshotSessionReady = null
    // Consent is per submission, not per visitor. A reporter who declined once
    // on a page with something private on it is not declining for every report
    // they ever file, and a team silently receiving no screenshots forever
    // would have no way to notice why.
    //
    // This covers the exit path only. A successful submit never routes through
    // exitAll, so the controller resets there as well.
    this.resetScreenshotConsent()
    const submission = this.activeSubmission
    this.activeSubmission = null
    this.pendingSubmissionRequest = null
    if (submission) {
      void this.deps.apiClient.abandonSubmissionSession(submission.id, submission.token).catch(() => {})
    }
  }
}

function waitForPaint(): Promise<void> {
  return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}
