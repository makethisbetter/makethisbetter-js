import { ShadowContainer } from './shadow'
import { isImeConfirmKeydown } from '../context/dom-utils'
import { FeedbackTab } from './tab'
import { FrustrationPromptCard } from './frustration-prompt'
import { DimOverlay } from './dim-overlay'
import { isTouchPointer } from './pointer-kind'
import { PageOffset } from './page-offset'
import { lockPageScroll } from './scroll-lock'
import type { ScrollLock } from './scroll-lock'
import { AnnotationToolbar } from '../annotate/toolbar'
import { AnnotationSession } from '../annotate/session'
import { DrawNoteBar } from '../annotate/draw-note-bar'
import { ChatPopup } from '../popup/chat-popup'
import { ReceiptCard } from '../popup/receipt'
import { warmFontEmbedCss } from '../screenshot/capture'
import { ConsoleErrorCollector } from '../context/console'
import { BreadcrumbCollector } from '../context/breadcrumbs'
import { FrustrationDetector } from '../context/frustration'
import { isFrustrationDismissed, markFrustrationDismissed } from '../context/frustration-state'
import { ApiClient } from '../api/client'
import { cacheBoardUrl, getAnonId, getCachedBoardUrl, getStoredReporterEmail, rememberReporterEmail } from './anon-id'
import { getMessages } from '../i18n'
import { RecordingManager } from './recording-manager'
import { SubmissionLifecycle } from './submission-lifecycle'
import { AnnotatingState, ChatClarifyingState, IdleState, PopupState, SubmittingState } from './mode-states'
import type { ModeHost, ModeState, NotePopupOptions } from './mode-states'
import type { MakeThisBetterConfig, Annotation, SubmissionSessionResponse, FeedbackResponse } from '../types'
import { resolveBrandColors } from './brand-colors'
import type { WidgetBrandColors } from './brand-colors'

type Via = 'pin' | 'draw' | 'record'

// A browser SDK has no build-time environment, so "is a developer watching?"
// has to be inferred. Loopback and the .local/.test dev TLDs are where an
// integrator runs; anything else is somebody's live site.
function isLocalHost(): boolean {
  const { hostname } = window.location
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.test')
  )
}

export class WidgetController implements ModeHost {
  private config: MakeThisBetterConfig
  private brandColors: WidgetBrandColors | undefined
  private shadow!: ShadowContainer
  private tab: FeedbackTab | null = null
  private toolbar: AnnotationToolbar | null = null
  private session: AnnotationSession | null = null
  private drawBar: DrawNoteBar | null = null
  private dim: DimOverlay | null = null
  private pageOffset = new PageOffset()
  private chatPopup: ChatPopup | null = null
  private scrollLock: ScrollLock | null = null
  private success: ReceiptCard | null = null
  private frustrationPrompt: FrustrationPromptCard | null = null
  private apiClient: ApiClient
  private consoleCollector: ConsoleErrorCollector
  private breadcrumbCollector: BreadcrumbCollector
  private frustrationDetector: FrustrationDetector | null = null
  private messages: ReturnType<typeof getMessages>
  // The mode machine. One state object per mode owns what mounts on entry and
  // how each input behaves there; the controller only delegates and keeps the
  // component references the states operate on (through the ModeHost verbs).
  private state: ModeState = new IdleState(this)
  private via: Via = 'pin'
  private currentAnnotation: Annotation | null = null
  private lastPopupPos: { x: number; y: number } | null = null
  private recordingManager: RecordingManager | null = null
  private lifecycle: SubmissionLifecycle
  private touchHintShown = false
  private lastHandoff: { feedbackId?: string; boardUrl?: string; identityToken?: string } = {}

  constructor(config: MakeThisBetterConfig) {
    this.config = config
    // A missing key still renders a fully working widget whose every submit
    // 401s — the reporter sees a generic failure and the integrator sees
    // nothing at all. Say it at init, where the integrator is looking.
    if (!config.projectKey) {
      console.warn('[MakeThisBetter] projectKey is missing. Feedback submission will be rejected.')
    }
    this.brandColors = resolveBrandColors(config.brandColors)
    this.messages = getMessages(config.locale ?? document.documentElement.lang ?? 'en')
    this.apiClient = new ApiClient({
      projectKey: config.projectKey,
      apiUrl: config.apiUrl,
      userToken: config.userToken,
      userTokenFn: config.userTokenFn,
    })
    this.consoleCollector = new ConsoleErrorCollector()
    this.consoleCollector.start()
    this.breadcrumbCollector = new BreadcrumbCollector()
    this.breadcrumbCollector.start()
    this.lifecycle = new SubmissionLifecycle(
      {
        apiClient: this.apiClient,
        consoleCollector: this.consoleCollector,
        breadcrumbCollector: this.breadcrumbCollector,
        brandColors: this.brandColors,
        shadow: () => this.shadow,
        messages: () => this.messages,
        user: () => this.config.user,
      },
      {
        isBackground: () => this.state.kind === 'submitting',
        onFinalizeFailure: (onRetry) => this.chatPopup?.showFinalizeFailure(onRetry),
        onReenterBackground: () => this.transitionTo(new SubmittingState(this)),
        onFinalized: (feedback, submission) => this.handleFinalized(feedback, submission),
      },
    )
    try {
      this.buildUI()
    } catch (error) {
      // A page-supplied host can be an element that refuses attachShadow. The
      // collectors above have already patched window.onerror and history, and
      // letting this throw into the customer's script would leave those
      // patches with no owner to release them — so roll back and go dark
      // instead of crashing code that is not ours.
      this.consoleCollector.stop()
      this.breadcrumbCollector.stop()
      console.warn('[MakeThisBetter] Widget failed to start:', error)
      return
    }

    if (config.frustrationDetection !== false) {
      this.frustrationDetector = new FrustrationDetector(() => this.handleFrustration())
      this.frustrationDetector.start()
    }

    document.addEventListener('keydown', this.handleKeydown, true)
  }

  /**
   * The single mutation point of the mode machine: the outgoing state exits,
   * the incoming state enters, and the launcher reflects the new mode.
   */
  transitionTo(next: ModeState): void {
    const previous = this.state
    this.state = next
    previous.exit()
    next.enter()
    this.tab?.setActive(next.launcherLit)
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    // Escape during IME composition cancels the candidate list, not the widget.
    // Without this a reporter typing Chinese or Japanese loses the popup and
    // everything they had written by backing out of one wrong candidate.
    if (isImeConfirmKeydown(event)) return

    this.state.handleEscape(event)
  }

  private buildUI(): void {
    this.shadow = new ShadowContainer(this.config.theme ?? 'auto', this.brandColors)

    if (this.config.entryMode === 'api') {
      // Nothing is reachable until the host wires up open(), and silence would
      // look identical to a broken install. But 'api' is a supported setting,
      // so a warning on every production page load would be a third-party SDK
      // shouting at customers who did nothing wrong — say it only where an
      // integrator is watching.
      if (isLocalHost()) {
        console.warn(
          '[MakeThisBetter] entryMode: "api" renders no launcher. ' +
          'Call MakeThisBetter.open() from your own UI.',
        )
      }
      return
    }

    // A phone gets no launcher of ours. The edge tab is 36x40 of someone
    // else's screen, and it is genuinely hard to find — its own author missed
    // it on a test page — while a narrow layout has no spare margin to dock
    // anything to. Where a feedback entry belongs on a phone is the host's
    // call, not a third-party script's, so touch renders nothing and waits for
    // open() from the host's own UI.
    if (isTouchPointer()) {
      if (isLocalHost()) {
        console.warn(
          '[MakeThisBetter] No launcher is rendered on touch devices. ' +
          'Call MakeThisBetter.open() from your own mobile UI.',
        )
      }
      return
    }

    this.mountTab()
  }

  private mountTab(): void {
    // No shadow means startup was rolled back; there is nowhere to mount.
    if (this.tab || !this.shadow) return
    this.tab = new FeedbackTab(
      this.shadow,
      this.messages,
      this.config.position ?? 'right',
      () => this.state.handleTabClick(),
      this.config.tabText,
    )
  }

  /** Opens annotation mode. Idempotent: a second call while open does nothing. */
  open(): void {
    if (!this.shadow) return
    this.state.handleOpen()
  }

  close(): void {
    this.state.handleClose()
  }

  showLauncher(): void {
    if (isTouchPointer()) return
    this.mountTab()
    this.tab?.setActive(this.state.launcherLit)
  }

  hideLauncher(): void {
    this.tab?.destroy()
    this.tab = null
  }

  // Takes effect for anything opened afterwards. Components already on screen keep
  // the language they were opened in rather than being re-rendered underneath a
  // reporter who may be mid-sentence.
  setLocale(locale: string): void {
    this.config.locale = locale
    this.messages = getMessages(locale)
    this.tab?.setMessages(this.messages)
  }

  private handleFrustration(): void {
    if (!this.state.acceptsFrustrationPrompt || this.frustrationPrompt || isFrustrationDismissed()) return

    this.frustrationPrompt = new FrustrationPromptCard(this.shadow, this.messages, {
      onTell: () => {
        this.dismissFrustrationPrompt()
        this.state.handleOpen()
      },
      onDismiss: () => {
        markFrustrationDismissed()
        this.dismissFrustrationPrompt()
      },
      // An unnoticed card is not a refusal, so it must not suppress later
      // prompts. The detector's own 60s cooldown does the rate limiting.
      onAutoHide: () => this.dismissFrustrationPrompt(),
    })
  }

  dismissSuccess(): void {
    this.success?.destroy()
    this.success = null
    // The chat card ends as its own receipt, so it is the previous
    // submission's success card on that path.
    this.chatPopup?.destroy()
    this.chatPopup = null
  }

  dismissFrustrationPrompt(): void {
    this.frustrationPrompt?.destroy()
    this.frustrationPrompt = null
  }

  hasAnnotationChrome(): boolean {
    return this.toolbar !== null
  }

  mountAnnotationChrome(): void {
    // Network-only warmup: annotating usually ends in a capture, and the font
    // embed CSS is the slow, cacheable half of one.
    void warmFontEmbedCss()
    const touch = isTouchPointer()

    this.toolbar = new AnnotationToolbar(
      this.shadow,
      this.messages,
      () => this.exitAll(),
      (mode) => this.state.handleToolbarModeChange(mode),
      // The bar stands at whichever edge the tab does. Leaving it pinned right
      // while a left-configured tab sat opposite would split the widget across
      // both sides of the page.
      this.config.position ?? 'right',
      !touch || !this.touchHintShown,
    )
    if (touch) this.touchHintShown = true
    this.ensureSession()
    // The bar is a full-bleed strip at the top on a phone. Left overlapping,
    // it covers roughly 100px of the page — usually the site's own header —
    // and taps there do nothing, silently. Give it room of its own instead.
    if (touch && this.toolbar) this.pageOffset.reserve(this.toolbar.height())
  }

  ensureSession(): void {
    if (this.session) return
    this.session = new AnnotationSession(this.shadow, this.messages, {
      onPin: (annotation, targetName) => {
        this.currentAnnotation = annotation
        this.via = 'pin'
        this.lifecycle.beginBaseCapture()
        this.transitionTo(new PopupState(this, {
          x: annotation.x,
          y: annotation.y,
          targetName,
          targetRect: annotation.targetRect,
        }))
      },
      onDrawStroke: () => {
        this.lifecycle.beginBaseCapture()
        this.state.handleDrawStroke()
      },
    })
  }

  destroySession(): void {
    this.session?.destroy()
    this.session = null
  }

  clearCurrentAnnotation(): void {
    this.currentAnnotation = null
  }

  startRecorder(): void {
    this.recordingManager = new RecordingManager()
    this.recordingManager.start(
      this.shadow,
      this.messages,
      this.stopRecordingIntoNote,
    ).catch((error) => {
      // rrweb failed to load (network / SRI mismatch) — fall back to markup
      console.warn('[MakeThisBetter] Interaction replay unavailable, falling back to markup:', error)
      // Staleness guard: the reporter may have left recording while the load
      // was still failing, and a stale fallback must not disturb wherever
      // they are now.
      if (this.state.kind !== 'recording') return
      this.toolbar?.setMode('markup')
      this.state.handleToolbarModeChange('markup')
    })
  }

  destroyRecordingManager(): void {
    this.recordingManager?.destroy()
    this.recordingManager = null
  }

  stopRecordingIntoNote = (): void => {
    if (!this.recordingManager) return
    this.recordingManager.stop()
    this.via = 'record'
    this.transitionTo(new PopupState(this, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      targetName: this.messages.record.timer_label,
    }))
  }

  mountDrawBar(): void {
    this.engageScrollLock()
    this.drawBar = new DrawNoteBar(this.shadow, {
      messages: this.messages,
      onUndo: () => this.handleDrawUndoRedo('undo'),
      onRedo: () => this.handleDrawUndoRedo('redo'),
      onCancel: () => this.cancelDraw(),
      onSubmit: (note) => this.handleDrawSubmit(note),
      onActivity: () => this.lifecycle.beginBaseCapture(),
    })
    // Strokes are baked onto the screenshot, so this surface offers no opt-out
    // and must undo one made earlier in the session.
    this.lifecycle.setScreenshotEnabled(true)
    this.lifecycle.warmScreenshotDeps()
  }

  /**
   * The note sheet for a finished drawing on touch.
   *
   * Cancel here means "throw the drawing away and keep annotating", not "close
   * the widget" — the reporter is mid-task and a stray stroke should cost one
   * tap, not the whole session.
   */
  mountDrawSheet(): void {
    // No dismissInteraction and no scrim here, matching the desktop draw bar:
    // the overlay stays live so more strokes are still possible, and the scrim
    // sits below it anyway so it could never receive the tap.
    this.engageScrollLock()
    // Cancel means "throw the drawing away" only while the drawing is still the
    // reporter's; once the note is sent the card is a receipt and closing it
    // ends the session instead.
    let submitted = false
    this.chatPopup = new ChatPopup(this.shadow, {
      targetName: this.messages.annotation.drawing,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      messages: this.messages,
      position: this.config.position ?? 'right',
      onSubmit: async (description: string) => {
        const annotation = this.session?.getDrawAnnotation()
        if (!annotation) {
          this.cancelDraw()
          return null
        }
        submitted = true
        this.currentAnnotation = annotation
        this.via = 'draw'
        this.session?.dismissInteraction()
        this.teardownDrawBar()
        const recording = this.recordingManager?.getRecording() ?? undefined
        const session = await this.lifecycle.start(
          description || this.messages.annotation.drawing,
          annotation,
          recording,
        )
        if (session?.board_url) cacheBoardUrl(session.board_url)
        return session
      },
      onClarify: async (sessionId: string, token: string, onDelta: (text: string) => void, signal?: AbortSignal) => {
        return this.apiClient.streamClarification(sessionId, token, onDelta, signal)
      },
      onAnswer: (sessionId: string, token: string, message: string) =>
        this.apiClient.answerClarification(sessionId, token, message),
      onFinalize: () => {
        this.transitionTo(new SubmittingState(this))
        return this.lifecycle.finalize()
      },
      onCancel: () => (submitted ? this.exitAll() : this.cancelDraw()),
      onConversationOpen: () => this.transitionTo(new ChatClarifyingState(this)),
      onActivity: () => this.lifecycle.beginBaseCapture(),
      resolveBoardLink: () => this.buildViewFeedbackHandler() ?? this.buildMyFeedbackHandler(),
      resolveEmailCapture: () => this.buildEmailCapture(),
    })
    // Same rule as the desktop draw bar: no opt-out on a drawing.
    this.lifecycle.setScreenshotEnabled(true)
    this.lifecycle.warmScreenshotDeps()
  }

  private handleDrawUndoRedo(action: 'undo' | 'redo'): void {
    if (action === 'undo') this.session?.undoDraw()
    else this.session?.redoDraw()
    this.refreshDrawBar()
  }

  refreshDrawBar(): void {
    if (!this.session) return
    this.drawBar?.setUndoRedo(this.session.canUndoDraw(), this.session.canRedoDraw())
  }

  cancelDraw(): void {
    this.session?.clearDraw()
    this.releaseScrollLock()
    this.teardownDrawBar()
    // On touch the sheet is the note surface, so cancelling the drawing has to
    // take the sheet and its scrim with it — teardownDrawBar only knows the bar.
    this.chatPopup?.destroy()
    this.chatPopup = null
    this.dim?.destroy()
    this.dim = null
    this.transitionTo(new AnnotatingState(this))
  }

  teardownDrawBar(): void {
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
    const description = note || this.messages.annotation.drawing
    const recording = this.recordingManager?.getRecording() ?? undefined

    this.teardownDrawBar()
    this.releaseScrollLock()
    this.dim?.destroy()
    this.dim = null

    this.mountChatAfterSubmit(description, annotation, recording)
  }

  private mountChatAfterSubmit(description: string, annotation: Annotation | null, recording: import('./recording-manager').RecordingResult | undefined): void {
    this.dim = new DimOverlay(this.shadow, () => this.exitAll())
    this.engageScrollLock()

    this.chatPopup = new ChatPopup(this.shadow, {
      targetName: annotation?.targetName ?? this.messages.annotation.drawing,
      x: this.lastPopupPos?.x ?? window.innerWidth / 2,
      y: this.lastPopupPos?.y ?? window.innerHeight / 2,
      messages: this.messages,
      position: this.config.position ?? 'right',
      onSubmit: async () => {
        const session = await this.lifecycle.start(description, annotation, recording)
        if (session?.board_url) cacheBoardUrl(session.board_url)
        return session
      },
      onClarify: async (sessionId: string, token: string, onDelta: (text: string) => void, signal?: AbortSignal) => {
        return this.apiClient.streamClarification(sessionId, token, onDelta, signal)
      },
      onAnswer: (sessionId: string, token: string, message: string) =>
        this.apiClient.answerClarification(sessionId, token, message),
      onFinalize: () => {
        this.transitionTo(new SubmittingState(this))
        return this.lifecycle.finalize()
      },
      onCancel: () => this.exitAll(),
      onConversationOpen: () => this.transitionTo(new ChatClarifyingState(this)),
      resolveBoardLink: () => this.buildViewFeedbackHandler() ?? this.buildMyFeedbackHandler(),
      resolveEmailCapture: () => this.buildEmailCapture(),
    })
    this.chatPopup.submit(description)
  }

  mountNotePopup({ x, y, targetName, targetRect }: NotePopupOptions): void {
    this.lastPopupPos = { x, y }
    this.teardownDrawBar()
    this.session?.dismissInteraction()
    this.chatPopup?.destroy()
    this.chatPopup = null
    this.dim?.destroy()
    this.dim = null
    this.dim = new DimOverlay(this.shadow, () => this.exitAll())
    const recording = this.recordingManager?.getRecording()
    if (recording) this.lifecycle.setScreenshotEnabled(true)

    const annotation = this.currentAnnotation
    const recordingResult = this.recordingManager?.getRecording() ?? undefined

    this.chatPopup = new ChatPopup(this.shadow, {
      targetName,
      x,
      y,
      targetRect,
      messages: this.messages,
      position: this.config.position ?? 'right',
      onSubmit: async (description: string) => {
        this.currentAnnotation = annotation ?? this.currentAnnotation
        const session = await this.lifecycle.start(description, this.currentAnnotation, recordingResult)
        if (session?.board_url) cacheBoardUrl(session.board_url)
        return session
      },
      onClarify: async (sessionId: string, token: string, onDelta: (text: string) => void, signal?: AbortSignal) => {
        return this.apiClient.streamClarification(sessionId, token, onDelta, signal)
      },
      onAnswer: (sessionId: string, token: string, message: string) =>
        this.apiClient.answerClarification(sessionId, token, message),
      // The chat card turns into a receipt at this point: the pin, the scrim
      // and the scroll lock have nothing left to hold. A finalization failure
      // remains in this card as a retryable receipt state.
      onFinalize: () => {
        this.teardownSubmittingUi()
        this.transitionTo(new SubmittingState(this))
        return this.lifecycle.finalize()
      },
      onCancel: () => this.exitAll(),
      onConversationOpen: () => this.transitionTo(new ChatClarifyingState(this)),
      onActivity: () => {
        if (annotation) this.lifecycle.beginBaseCapture()
        else this.lifecycle.warmScreenshotDeps()
      },
      resolveBoardLink: () => this.buildViewFeedbackHandler() ?? this.buildMyFeedbackHandler(),
      resolveEmailCapture: () => this.buildEmailCapture(),
      ...(recording
        ? { recordingSeconds: recording.duration }
        : {
            onScreenshotToggle: (enabled: boolean) => this.lifecycle.setScreenshotEnabled(enabled),
            screenshotEnabled: this.lifecycle.isScreenshotEnabled(),
          }),
    })
    this.engageScrollLock()
    this.lifecycle.warmScreenshotDeps()
  }

  /**
   * The Markup-button escape from a note popup. The popup's mount destroyed
   * the session's overlay (dismissInteraction), so the session goes with it —
   * AnnotatingState.enter() rebuilds a fresh one and the reporter can point
   * and draw again, rather than facing a dead overlay under a leftover scrim.
   */
  dismissNotePopup(): void {
    this.chatPopup?.destroy()
    this.chatPopup = null
    this.dim?.destroy()
    this.dim = null
    this.releaseScrollLock()
    this.clearCurrentAnnotation()
    this.destroySession()
  }

  private engageScrollLock(): void {
    // Re-entrant: record mode returns here and mounts a fresh popup over the
    // existing one, and a second lock would leave a listener behind.
    if (!this.scrollLock) this.scrollLock = lockPageScroll()
  }

  private releaseScrollLock(): void {
    this.scrollLock?.release()
    this.scrollLock = null
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

  private teardownSubmittingUi(): void {
    // The highlight exists to hold the target visible under a pin. This is
    // where the session — and with it the pin — goes away, so the highlight
    // has to go with it rather than outliving what it pointed at.
    this.teardownDrawBar()
    // The pin goes away with the session below, so nothing anchored is left for
    // a scroll to strand — the conversation that follows scrolls freely.
    this.releaseScrollLock()
    this.dim?.destroy()
    this.dim = null
    this.session?.hideHighlight()
    this.session?.destroy()
    this.session = null
    this.recordingManager?.destroy()
    this.recordingManager = null
  }

  revertToolbarDuringClarify(): void {
    this.toolbar?.setMode(this.via === 'record' ? 'record' : 'markup')
  }

  releaseClarifyUi(): void {
    this.teardownToolbar()
    this.currentAnnotation = null
    // The card is not destroyed here: the skip path's card dismisses itself
    // after handing off, and every other entry into submitting finds it gone.
  }

  private handleFinalized(feedback: FeedbackResponse, submission: SubmissionSessionResponse): void {
    this.lastHandoff = {
      feedbackId: feedback.id,
      boardUrl: feedback.board_url,
      identityToken: feedback.identity_token,
    }
    if (feedback.board_url) cacheBoardUrl(feedback.board_url)

    // A finalize that lands after the reporter already started their next
    // report must not touch the screen: any toolbar, consent state or chat
    // card up now belongs to the new report, not to this submission. The
    // hand-off above is still recorded — it is about the finalized feedback,
    // not about what is on screen.
    if (this.chatPopup && this.chatPopup.sessionId() !== submission.id) return
    if (!this.chatPopup && this.state.kind !== 'submitting' && this.state.kind !== 'clarifying') return

    if (this.chatPopup) {
      this.chatPopup.showFinalizeSuccess()
      this.teardownSubmittingUi()
      this.teardownToolbar()
      this.lifecycle.resetScreenshotConsent()
      this.transitionTo(new IdleState(this))
      return
    }

    this.teardownToolbar()
    this.lifecycle.resetScreenshotConsent()
    this.showSuccess({ skipFollowup: submission.ai_clarify_available === false })
  }

  private showSuccess(options?: { skipFollowup?: boolean }): void {
    this.transitionTo(new IdleState(this))
    this.success = new ReceiptCard(this.shadow, this.messages, () => {
      this.success?.destroy()
      this.success = null
    }, { ...options, onViewFeedback: this.buildViewFeedbackHandler() })
  }

  private buildEmailCapture(): { onSubmit: (email: string) => Promise<boolean> } | undefined {
    if (this.config.user) return undefined
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
        // resolveUserToken runs the host's own userTokenFn. A rejection there
        // is the customer's backend failing, not ours — swallowing it beats
        // handing their page an unhandled rejection from a click handler they
        // never wrote.
        try {
          const token = await this.apiClient.resolveUserToken()
          if (token) window.open(`${boardUrl}?identity=${encodeURIComponent(token)}`, '_blank')
        } catch {
          // The board link just does nothing; the feedback itself already sent.
        }
      }
    }

    return undefined
  }

  /**
   * The reserved strip belongs to the toolbar, so it goes back the moment the
   * toolbar does. Both teardown paths route through here: exit, and the
   * successful submit — which never passes through exitAll and used to leave
   * the host page padded for the rest of its life.
   */
  private teardownToolbar(): void {
    this.pageOffset.release()
    this.toolbar?.destroy()
    this.toolbar = null
  }

  exitAll(): void {
    this.lifecycle.abandon()
    this.via = 'pin'
    this.transitionTo(new IdleState(this))
    // Ahead of anything that can throw: a half-torn-down widget is survivable,
    // a host page left permanently padded is not.
    this.teardownToolbar()
    this.teardownDrawBar()
    this.releaseScrollLock()
    this.session?.hideHighlight()
    this.session?.destroy()
    this.session = null
    this.dim?.destroy()
    this.dim = null
    this.chatPopup?.destroy()
    this.chatPopup = null
    this.currentAnnotation = null
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
    this.success?.destroy()
    this.tab?.destroy()
    this.recordingManager?.destroy()
    // Undefined when startup rolled back before the shadow container existed.
    this.shadow?.destroy()
  }
}
