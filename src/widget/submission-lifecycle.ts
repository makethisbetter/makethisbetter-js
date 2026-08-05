import { FailureCard } from '../popup/failure'
import { bakeAnnotatedScreenshot, captureBaseScreenshot } from '../screenshot/capture'
import type { BaseScreenshot } from '../screenshot/capture'
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
// Rasterizing the page blocks the main thread for long enough to make typing
// stutter, so the early capture waits for a pause instead of racing the first
// keystrokes. Reporters pause to re-read before submitting; the rare one who
// types straight through to Enter falls back to capturing at submit.
const IDLE_CAPTURE_MS = 900

/**
 * Mode/UI transitions the lifecycle needs from its owner. The controller owns
 * mode and the launcher tab; the lifecycle only reports when a submission
 * outcome forces a transition, so "which UI is on screen" stays decided in one
 * place.
 */
export interface SubmissionLifecycleHost {
  /** True when the clarify card is gone and failures must surface on their own card. */
  isBackground(): boolean
  /** Make the widget usable again before the failure card shows. */
  onReleaseForFailureCard(): void
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
  private pendingBaseCapture: Promise<BaseScreenshot | null> | null = null
  private idleCaptureTimer: ReturnType<typeof setTimeout> | null = null
  private failure: FailureCard | null = null
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
   * Turning it off cancels the deferred capture and drops the reference to any
   * result already produced, so nothing survives to be sent at submit. A
   * rasterization already running cannot be cancelled — its bitmap completes
   * and is discarded unreferenced. Turning consent back on restarts the same
   * idle-deferred capture the surfaces ask for.
   */
  setScreenshotEnabled(enabled: boolean): void {
    this.screenshotEnabled = enabled
    if (enabled) {
      this.beginBaseCapture()
      return
    }
    this.clearIdleCaptureTimer()
    this.pendingBaseCapture = null
  }

  // Rasterize the page once a note surface is open, so submit only pays for
  // the annotation bake — but never while the reporter is actively typing:
  // the note surfaces call this again on every keystroke, and each call pushes
  // the capture back until a pause. Strokes and pins are baked from annotation
  // data at submit, so annotating after the capture fires loses nothing.
  beginBaseCapture(): void {
    if (!this.screenshotEnabled) return
    if (this.pendingBaseCapture) return
    this.clearIdleCaptureTimer()
    this.idleCaptureTimer = setTimeout(() => {
      this.idleCaptureTimer = null
      this.pendingBaseCapture ??= captureBaseScreenshot()
    }, IDLE_CAPTURE_MS)
  }

  private clearIdleCaptureTimer(): void {
    if (this.idleCaptureTimer !== null) {
      clearTimeout(this.idleCaptureTimer)
      this.idleCaptureTimer = null
    }
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
    // Let the clarify card paint its thinking state before capture work blocks
    // the main thread. The popup normally started the base capture already; the
    // fallback covers flows that submit without one (retry, programmatic).
    // Capture takes long enough for the reporter to change their mind mid-way,
    // and exitAll — the path both Exit and destroy() take — bumps the attempt.
    // Re-checking after every await keeps a cancelled screenshot, recording and
    // page context from ever reaching the server: the abandon below can only
    // clean up what was already in flight, and if that DELETE fails the private
    // payload sits on the server until it expires.
    await waitForPaint()
    if (submissionAttempt !== this.submissionAttempt) return null
    // Submit is the deadline the idle gate was deferring toward: a capture
    // still waiting out a typing pause runs now instead.
    this.clearIdleCaptureTimer()
    // Declining the screenshot skips the rasterization outright rather than
    // taking one and dropping it — nothing is ever produced to leak.
    const baseCapture = this.screenshotEnabled
      ? this.pendingBaseCapture ?? captureBaseScreenshot()
      : null
    this.pendingBaseCapture = null
    const pageContext = collectPageContext()
    const base = await baseCapture
    if (submissionAttempt !== this.submissionAttempt) return null
    const screenshot = base ? await bakeAnnotatedScreenshot(base, annotation ? [annotation] : [], this.deps.brandColors) : null
    if (submissionAttempt !== this.submissionAttempt) return null

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
    })

    try {
      const submission = await this.deps.apiClient.createSubmissionSession(payload, screenshot)
      // The residual window: the POST was already on the wire when the reporter
      // exited, so the only way back is to abandon what the server created.
      if (submissionAttempt !== this.submissionAttempt) {
        await this.deps.apiClient.abandonSubmissionSession(submission.id, submission.token).catch(() => {})
        return null
      }
      this.activeSubmission = submission
      return submission
    } catch {
      return null
    }
  }

  async finalize(): Promise<void> {
    const submissionAttempt = this.submissionAttempt
    // The clarification card is gone on the skip path, so its inline retry
    // footer can no longer report anything: this run has to surface its own
    // failure instead of throwing into a destroyed card.
    const background = this.host.isBackground()
    // Finalize can be asked for (skip button) while the session upload is still
    // in flight — wait for it rather than failing a healthy submission.
    const submission = this.activeSubmission ?? await (this.pendingSubmissionRequest ?? Promise.resolve(null))
    if (submissionAttempt !== this.submissionAttempt) return
    if (!submission) {
      if (background) return this.showFinalizeFailure({ canRetry: false })
      throw new Error('No active submission session')
    }

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

  private showFinalizeFailure(options: {canRetry: boolean}): void {
    // Release the launcher first: whatever the reporter does with this card,
    // the widget must be usable again.
    this.host.onReleaseForFailureCard()
    this.failure?.destroy()
    this.failure = new FailureCard(this.deps.shadow(), this.deps.messages(), {
      onRetry: options.canRetry ? () => this.retryBackgroundFinalization() : undefined,
      onClose: () => this.dismissFinalizeFailure(),
    })
  }

  private retryBackgroundFinalization(): void {
    this.dismissFinalizeFailure()
    // Re-enter the background state so another failure comes back to this card
    // rather than throwing with nothing on screen.
    this.host.onReenterBackground()
    void this.finalize().catch(() => this.showFinalizeFailure({canRetry: true}))
  }

  dismissFinalizeFailure(): void {
    this.failure?.destroy()
    this.failure = null
  }

  /**
   * Invalidate every in-flight attempt and abandon what already reached the
   * server. Both exit and destroy route through here.
   */
  abandon(): void {
    this.submissionAttempt += 1
    this.clearIdleCaptureTimer()
    this.pendingBaseCapture = null
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
