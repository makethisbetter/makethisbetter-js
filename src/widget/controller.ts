import { ShadowContainer } from './shadow'
import { FeedbackTab } from './tab'
import { FrustrationPromptCard } from './frustration-prompt'
import { DimOverlay } from './dim-overlay'
import { AnnotationToolbar } from '../annotate/toolbar'
import type { ToolbarMode } from '../annotate/toolbar'
import { AnnotationSession } from '../annotate/session'
import { DrawNoteBar } from '../annotate/draw-note-bar'
import { CommentPopup } from '../popup/comment'
import { ClarifyCard } from '../popup/clarify'
import type { ClarifySummaryContext } from '../popup/clarify'
import { SuccessCard } from '../popup/success'
import type { SuccessCardOptions } from '../popup/success'
import { captureScreenshot } from '../screenshot/capture'
import { ConsoleErrorCollector } from '../context/console'
import { BreadcrumbCollector } from '../context/breadcrumbs'
import { FrustrationDetector } from '../context/frustration'
import { collectPageContext } from '../context/collector'
import type { PageContext } from '../context/collector'
import { ApiClient } from '../api/client'
import { buildPayload } from './payload'
import { cacheBoardUrl, getAnonId, getCachedBoardUrl, getStoredReporterEmail, rememberReporterEmail } from './anon-id'
import { getMessages } from '../i18n'
import { RecordingManager } from './recording-manager'
import type { MakeThisBetterConfig, Annotation, SubmissionSessionResponse } from '../types'

type Mode = 'idle' | 'annotating' | 'recording' | 'drawing' | 'popup' | 'clarifying'
type Via = 'pin' | 'draw' | 'record'

interface SubmittingUi {
  setLoading: (loading: boolean) => void
  setError: (message: string) => void
}

export class WidgetController {
  private config: MakeThisBetterConfig
  private shadow!: ShadowContainer
  private tab: FeedbackTab | null = null
  private toolbar: AnnotationToolbar | null = null
  private session: AnnotationSession | null = null
  private drawBar: DrawNoteBar | null = null
  private dim: DimOverlay | null = null
  private popup: CommentPopup | null = null
  private clarify: ClarifyCard | null = null
  private success: SuccessCard | null = null
  private frustrationPrompt: FrustrationPromptCard | null = null
  private apiClient: ApiClient
  private consoleCollector: ConsoleErrorCollector
  private breadcrumbCollector: BreadcrumbCollector
  private frustrationDetector: FrustrationDetector | null = null
  private messages: ReturnType<typeof getMessages>
  private mode: Mode = 'idle'
  private via: Via = 'pin'
  private currentAnnotation: Annotation | null = null
  private submittingUi: SubmittingUi | null = null
  private lastPopupPos: { x: number; y: number } | null = null
  private recordingManager: RecordingManager | null = null
  private activeSubmission: SubmissionSessionResponse | null = null
  private submissionAttempt = 0
  private lastHandoff: { feedbackId?: string; boardUrl?: string; identityToken?: string } = {}

  constructor(config: MakeThisBetterConfig) {
    this.config = config
    this.messages = getMessages(config.locale ?? 'en')
    this.apiClient = new ApiClient(config.projectKey, config.apiUrl, undefined, config.userToken, config.userTokenFn)
    this.consoleCollector = new ConsoleErrorCollector()
    this.consoleCollector.start()
    this.breadcrumbCollector = new BreadcrumbCollector()
    this.breadcrumbCollector.start()
    this.buildUI()

    if (config.frustrationDetection !== false) {
      this.frustrationDetector = new FrustrationDetector(() => this.handleFrustration())
      this.frustrationDetector.start()
    }

    document.addEventListener('keydown', this.handleKeydown, true)
  }

  // Escape only acts while the widget is in an active state; idle/clarifying
  // fall through untouched so the host page's own Escape handling still works.
  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return

    switch (this.mode) {
      case 'annotating':
      case 'popup':
        event.preventDefault()
        event.stopPropagation()
        this.exitAll()
        break
      case 'drawing':
        event.preventDefault()
        event.stopPropagation()
        this.cancelDraw()
        break
      case 'recording':
        event.preventDefault()
        event.stopPropagation()
        this.handleRecordStop()
        break
      default:
        break
    }
  }

  private buildUI(): void {
    this.shadow = new ShadowContainer(this.config.theme ?? 'auto')

    this.tab = new FeedbackTab(
      this.shadow,
      this.messages,
      this.config.position ?? 'right',
      () => this.handleTabClick(),
      this.config.tabText,
    )
  }

  private handleTabClick(): void {
    if (this.mode === 'idle') {
      this.dismissFrustrationPrompt()
      this.enterAnnotationMode()
    } else {
      this.exitAll()
    }
  }

  private handleFrustration(): void {
    if (this.mode !== 'idle' || this.frustrationPrompt) return

    this.frustrationPrompt = new FrustrationPromptCard(this.shadow, this.messages, {
      onTell: () => {
        this.dismissFrustrationPrompt()
        this.enterAnnotationMode()
      },
      onDismiss: () => this.dismissFrustrationPrompt(),
    })
  }

  private dismissFrustrationPrompt(): void {
    this.frustrationPrompt?.destroy()
    this.frustrationPrompt = null
  }

  private enterAnnotationMode(): void {
    this.mode = 'annotating'
    this.tab?.setActive(true)

    this.toolbar = new AnnotationToolbar(
      this.shadow,
      this.messages,
      () => this.exitAll(),
      (mode: ToolbarMode) => this.handleToolbarModeChange(mode),
    )
    this.session = this.createSession()
  }

  private createSession(): AnnotationSession {
    return new AnnotationSession(this.shadow, this.messages, {
      onPin: (annotation, targetName) => {
        this.currentAnnotation = annotation
        this.via = 'pin'
        this.showPopup(annotation.x, annotation.y, targetName)
      },
      onDrawStroke: () => this.handleDrawStroke(),
    })
  }

  private handleToolbarModeChange(mode: ToolbarMode): void {
    if (this.mode === 'clarifying') {
      this.toolbar?.setMode(this.via === 'record' ? 'record' : 'markup')
      return
    }

    if (mode === 'record') {
      if (this.mode === 'recording') return

      this.mode = 'recording'
      this.currentAnnotation = null
      this.teardownDraw()
      this.session?.destroy()
      this.session = null
      this.recordingManager = new RecordingManager()
      this.recordingManager.start(this.shadow, this.messages, this.handleRecordStop).catch((error) => {
        // rrweb failed to load (network / SRI mismatch) — fall back to markup
        console.warn('[MakeThisBetter] Interaction replay unavailable, falling back to markup:', error)
        if (this.mode !== 'recording') return
        this.toolbar?.setMode('markup')
        this.handleToolbarModeChange('markup')
      })
    } else {
      this.recordingManager?.destroy()
      this.recordingManager = null
      this.teardownDraw()
      if (!this.session) this.session = this.createSession()
      this.mode = 'annotating'
    }
  }

  private handleRecordStop = (): void => {
    if (!this.recordingManager) return
    this.recordingManager.stop()
    this.via = 'record'
    this.showPopup(window.innerWidth / 2, window.innerHeight / 2, this.messages.record.timer_label)
  }

  private handleDrawStroke(): void {
    if (this.mode !== 'drawing') {
      this.mode = 'drawing'
      this.drawBar = new DrawNoteBar(this.shadow, {
        messages: this.messages,
        onUndo: () => this.handleDrawUndoRedo('undo'),
        onRedo: () => this.handleDrawUndoRedo('redo'),
        onCancel: () => this.cancelDraw(),
        onSubmit: (note) => this.handleDrawSubmit(note),
      })
    }
    this.refreshDrawBar()
  }

  private handleDrawUndoRedo(action: 'undo' | 'redo'): void {
    if (action === 'undo') this.session?.undoDraw()
    else this.session?.redoDraw()
    this.refreshDrawBar()
  }

  private refreshDrawBar(): void {
    if (!this.session) return
    this.drawBar?.setUndoRedo(this.session.canUndoDraw(), this.session.canRedoDraw())
  }

  private cancelDraw(): void {
    this.session?.clearDraw()
    this.teardownDraw()
    this.mode = 'annotating'
  }

  private teardownDraw(): void {
    this.drawBar?.destroy()
    this.drawBar = null
  }

  private handleDrawSubmit(note: string): void {
    const annotation = this.session?.getDrawAnnotation()
    if (!annotation) {
      this.cancelDraw()
      return
    }
    this.currentAnnotation = annotation
    this.via = 'draw'
    this.session?.dismissInteraction()
    this.submittingUi = this.drawBar
    void this.handleSubmit(note || this.messages.annotation.drawing)
  }

  private showPopup(x: number, y: number, targetName: string): void {
    this.mode = 'popup'
    this.lastPopupPos = { x, y }
    this.teardownDraw()
    this.session?.dismissInteraction()
    this.popup?.destroy()
    this.popup = null
    this.dim?.destroy()
    this.dim = null
    this.dim = new DimOverlay(this.shadow, () => this.exitAll())

    this.popup = new CommentPopup(this.shadow, {
      targetName,
      x,
      y,
      messages: this.messages,
      onSubmit: (description) => this.handleSubmit(description),
      onClose: () => this.exitAll(),
      onMyFeedback: this.buildMyFeedbackHandler(),
    })
    this.submittingUi = this.popup
  }

  private buildMyFeedbackHandler(): (() => void) | undefined {
    if (this.config.user) return undefined
    if (!getCachedBoardUrl()) return undefined

    return async () => {
      const exchange = await this.apiClient.createIdentityToken(getAnonId())
      if (!exchange?.identity_token || !exchange.board_url) return
      cacheBoardUrl(exchange.board_url)
      window.open(`${exchange.board_url}?identity=${encodeURIComponent(exchange.identity_token)}`, '_blank')
    }
  }

  private async handleSubmit(description: string): Promise<void> {
    const ui = this.submittingUi
    if (!ui) return
    const submissionAttempt = ++this.submissionAttempt
    ui.setLoading(true)
    await waitForPaint()
    const annotation = this.currentAnnotation
    const recording = this.recordingManager?.getRecording() ?? undefined

    const [screenshot, pageContext] = await Promise.all([
      captureScreenshot(annotation ? [annotation] : []),
      Promise.resolve(collectPageContext()),
    ])

    const payload = buildPayload(
      description,
      pageContext,
      this.consoleCollector.getErrors(),
      annotation,
      this.config.user,
      recording,
      this.config.user ? undefined : getAnonId(),
      this.config.user ? undefined : getStoredReporterEmail(),
      this.breadcrumbCollector.getBreadcrumbs(),
    )

    try {
      const submission = await this.apiClient.createSubmissionSession(payload, screenshot)
      if (submissionAttempt !== this.submissionAttempt) {
        await this.apiClient.abandonSubmissionSession(submission.id, submission.token).catch(() => {})
        return
      }
      this.activeSubmission = submission
      const summary = this.buildSummaryContext(description, pageContext, annotation)
      this.teardownDraw()
      this.popup?.destroy()
      this.popup = null
      this.dim?.destroy()
      this.dim = null
      this.session?.destroy()
      this.session = null
      this.recordingManager?.destroy()
      this.recordingManager = null
      this.submittingUi = null
      this.showClarify(submission, this.lastPopupPos, summary)
    } catch {
      if (submissionAttempt !== this.submissionAttempt) return
      ui.setLoading(false)
      ui.setError(this.messages.error.submit)
    }
  }

  private buildSummaryContext(
    description: string,
    pageContext: PageContext,
    annotation: Annotation | null,
  ): ClarifySummaryContext {
    const s = this.messages.clarify.summary
    return {
      originalDescription: description,
      element: annotation?.targetName ?? this.messages.annotation.element,
      page: pageContext.page_url,
      browser: `${pageContext.browser} · ${pageContext.os}`,
      captured: this.via === 'record' ? s.recording : s.screenshot,
    }
  }

  private showClarify(
    submission: SubmissionSessionResponse,
    pos: { x: number; y: number } | null,
    summary: ClarifySummaryContext,
  ): void {
    // 'clarifying' keeps the tab and frustration prompt from starting a second
    // feedback while the current one is still being clarified.
    this.mode = 'clarifying'
    this.tab?.setActive(true)
    this.clarify = new ClarifyCard(this.shadow, {
      submissionSessionId: submission.id,
      submissionToken: submission.token,
      apiClient: this.apiClient,
      messages: this.messages,
      summary,
      x: pos?.x,
      y: pos?.y,
      onFinalize: () => this.finalizeSubmission(),
    })
  }

  private async finalizeSubmission(): Promise<void> {
    const submission = this.activeSubmission
    if (!submission) throw new Error('No active submission session')
    const submissionAttempt = this.submissionAttempt

    const feedback = await this.apiClient.finalizeSubmissionSession(submission.id, submission.token)
    if (submissionAttempt !== this.submissionAttempt || this.activeSubmission !== submission) return

    this.activeSubmission = null
    this.lastHandoff = {
      feedbackId: feedback.id,
      boardUrl: feedback.board_url,
      identityToken: feedback.identity_token,
    }
    if (feedback.board_url) cacheBoardUrl(feedback.board_url)
    this.clarify?.destroy()
    this.clarify = null
    this.toolbar?.destroy()
    this.toolbar = null
    this.showSuccess({ skipFollowup: submission.ai_clarify_available === false })
  }

  private showSuccess(options?: SuccessCardOptions): void {
    this.mode = 'idle'
    this.tab?.setActive(false)
    this.success = new SuccessCard(this.shadow, this.messages, () => {
      this.success?.destroy()
      this.success = null
    }, this.buildViewFeedbackHandler(), { ...options, emailCapture: this.buildEmailCapture() })
  }

  private buildEmailCapture(): { onSubmit: (email: string) => Promise<boolean> } | undefined {
    const { feedbackId, identityToken } = this.lastHandoff
    if (!feedbackId || !identityToken) return undefined
    if (getStoredReporterEmail()) return undefined

    return {
      onSubmit: async (email: string) => {
        const saved = await this.apiClient.updateReporter(feedbackId, email, identityToken)
        if (saved) rememberReporterEmail(email)
        return saved
      },
    }
  }

  private buildViewFeedbackHandler(): (() => void) | undefined {
    const { boardUrl, identityToken } = this.lastHandoff
    if (!boardUrl) return undefined

    if (identityToken) {
      return () => {
        window.open(`${boardUrl}?identity=${encodeURIComponent(identityToken)}`, '_blank')
      }
    }

    if (this.config.userToken || this.config.userTokenFn) {
      return async () => {
        const token = await this.apiClient.resolveUserToken()
        if (token) window.open(`${boardUrl}?identity=${encodeURIComponent(token)}`, '_blank')
      }
    }

    return undefined
  }

  private exitAll(): void {
    this.submissionAttempt += 1
    const submission = this.activeSubmission
    this.activeSubmission = null
    if (submission) {
      void this.apiClient.abandonSubmissionSession(submission.id, submission.token).catch(() => {})
    }
    this.mode = 'idle'
    this.via = 'pin'
    this.tab?.setActive(false)
    this.teardownDraw()
    this.toolbar?.destroy()
    this.toolbar = null
    this.session?.destroy()
    this.session = null
    this.dim?.destroy()
    this.dim = null
    this.popup?.destroy()
    this.popup = null
    this.clarify?.destroy()
    this.clarify = null
    this.currentAnnotation = null
    this.submittingUi = null
    this.recordingManager?.destroy()
    this.recordingManager = null
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeydown, true)
    this.exitAll()
    this.consoleCollector.stop()
    this.breadcrumbCollector.stop()
    this.frustrationDetector?.stop()
    this.dismissFrustrationPrompt()
    this.clarify?.destroy()
    this.success?.destroy()
    this.tab?.destroy()
    this.recordingManager?.destroy()
    this.shadow.destroy()
  }
}

function waitForPaint(): Promise<void> {
  return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
}
