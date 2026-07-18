import { ShadowContainer } from './shadow'
import { FeedbackTab } from './tab'
import { FrustrationPromptCard } from './frustration-prompt'
import { AnnotationToolbar } from '../annotate/toolbar'
import type { ToolbarMode } from '../annotate/toolbar'
import { AnnotationSession } from '../annotate/session'
import { CommentPopup } from '../popup/comment'
import { ClarifyCard } from '../popup/clarify'
import { SuccessCard } from '../popup/success'
import type { SuccessCardOptions } from '../popup/success'
import { captureScreenshot } from '../screenshot/capture'
import { ConsoleErrorCollector } from '../context/console'
import { FrustrationDetector } from '../context/frustration'
import { collectPageContext } from '../context/collector'
import { ApiClient } from '../api/client'
import { buildPayload } from './payload'
import { cacheBoardUrl, getAnonId, getCachedBoardUrl, getStoredReporterEmail, rememberReporterEmail } from './anon-id'
import { getMessages } from '../i18n'
import { RecordingManager } from './recording-manager'
import type { MakeThisBetterConfig, Annotation } from '../types'

type Mode = 'idle' | 'annotating' | 'recording' | 'popup' | 'clarifying'

export class WidgetController {
  private config: MakeThisBetterConfig
  private shadow!: ShadowContainer
  private tab: FeedbackTab | null = null
  private toolbar: AnnotationToolbar | null = null
  private session: AnnotationSession | null = null
  private popup: CommentPopup | null = null
  private clarify: ClarifyCard | null = null
  private success: SuccessCard | null = null
  private frustrationPrompt: FrustrationPromptCard | null = null
  private apiClient: ApiClient
  private consoleCollector: ConsoleErrorCollector
  private frustrationDetector: FrustrationDetector | null = null
  private messages: ReturnType<typeof getMessages>
  private mode: Mode = 'idle'
  private currentAnnotation: Annotation | null = null
  private lastPopupPos: { x: number; y: number } | null = null
  private recordingManager: RecordingManager | null = null
  private lastHandoff: { feedbackId?: string; boardUrl?: string; identityToken?: string } = {}

  constructor(config: MakeThisBetterConfig) {
    this.config = config
    this.messages = getMessages(config.locale ?? 'en')
    this.apiClient = new ApiClient(config.projectKey, config.apiUrl, undefined, config.userToken, config.userTokenFn)
    this.consoleCollector = new ConsoleErrorCollector()
    this.consoleCollector.start()
    this.buildUI()

    if (config.frustrationDetection !== false) {
      this.frustrationDetector = new FrustrationDetector(() => this.handleFrustration())
      this.frustrationDetector.start()
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
    this.session = new AnnotationSession(this.shadow, this.messages, (annotation, targetName) => {
      this.currentAnnotation = annotation
      this.showPopup(annotation.x, annotation.y, targetName)
    })
  }

  private handleToolbarModeChange(mode: ToolbarMode): void {
    if (mode === 'record') {
      this.mode = 'recording'
      this.session?.destroy()
      this.session = null
      this.recordingManager = new RecordingManager()
      this.recordingManager.start(this.shadow, this.messages, () => {
        if (!this.recordingManager) return
        this.recordingManager.stop()
        this.showPopup(window.innerWidth / 2, window.innerHeight / 2, this.messages.record.timer_label)
      }).catch((error) => {
        // rrweb failed to load (network / SRI mismatch) — fall back to markup
        console.warn('[MakeThisBetter] Screen recording unavailable, falling back to markup:', error)
        if (this.mode !== 'recording') return
        this.toolbar?.setMode('markup')
        this.handleToolbarModeChange('markup')
      })
    } else {
      this.recordingManager?.destroy()
      this.recordingManager = null
      if (!this.session) {
        this.session = new AnnotationSession(this.shadow, this.messages, (annotation, targetName) => {
          this.currentAnnotation = annotation
          this.showPopup(annotation.x, annotation.y, targetName)
        })
      }
      this.mode = 'annotating'
    }
  }

  private showPopup(x: number, y: number, targetName: string): void {
    this.mode = 'popup'
    this.lastPopupPos = { x, y }
    this.session?.dismissInteraction()

    this.popup = new CommentPopup(this.shadow, {
      targetName,
      x,
      y,
      messages: this.messages,
      onSubmit: (description) => this.handleSubmit(description),
      onClose: () => this.exitAll(),
      onMyFeedback: this.buildMyFeedbackHandler(),
    })
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
    if (!this.popup) return
    this.popup.setLoading(true)
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
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
    )

    try {
      const feedback = await this.apiClient.submitFeedback(payload, screenshot)
      this.lastHandoff = { feedbackId: feedback.id, boardUrl: feedback.board_url, identityToken: feedback.identity_token }
      if (feedback.board_url) cacheBoardUrl(feedback.board_url)
      this.popup?.destroy()
      this.popup = null
      this.session?.destroy()
      this.session = null
      this.toolbar?.destroy()
      this.toolbar = null
      this.recordingManager?.destroy()
      this.recordingManager = null
      const skipFollowup = feedback.skip_followup === true || feedback.ai_clarify_available === false
      if (skipFollowup) {
        this.showSuccess({ skipFollowup: true })
      } else {
        this.showClarify(feedback.id, this.lastPopupPos)
      }
    } catch {
      this.popup?.setLoading(false)
      this.popup?.setError(this.messages.error.submit)
    }
  }

  private showClarify(feedbackId: string, pos: { x: number; y: number } | null): void {
    // 'clarifying' keeps the tab and frustration prompt from starting a second
    // feedback while the current one is still being clarified.
    this.mode = 'clarifying'
    this.tab?.setActive(true)
    this.clarify = new ClarifyCard(this.shadow, {
      feedbackId,
      apiClient: this.apiClient,
      messages: this.messages,
      x: pos?.x,
      y: pos?.y,
      onDone: () => {
        this.clarify?.destroy()
        this.clarify = null
        this.showSuccess()
      },
    })
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
    this.mode = 'idle'
    this.tab?.setActive(false)
    this.toolbar?.destroy()
    this.toolbar = null
    this.session?.destroy()
    this.session = null
    this.popup?.destroy()
    this.popup = null
    this.clarify?.destroy()
    this.clarify = null
    this.currentAnnotation = null
    this.recordingManager?.destroy()
    this.recordingManager = null
  }

  destroy(): void {
    this.exitAll()
    this.consoleCollector.stop()
    this.frustrationDetector?.stop()
    this.dismissFrustrationPrompt()
    this.clarify?.destroy()
    this.success?.destroy()
    this.tab?.destroy()
    this.recordingManager?.destroy()
    this.shadow.destroy()
  }
}
