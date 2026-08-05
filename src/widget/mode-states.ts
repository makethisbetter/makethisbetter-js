import { isTouchPointer } from './pointer-kind'
import type { ToolbarMode } from '../annotate/toolbar'
import type { SubmissionSessionResponse, TargetRect } from '../types'

export type ModeKind = 'idle' | 'annotating' | 'recording' | 'drawing' | 'popup' | 'clarifying' | 'submitting'

export interface NotePopupOptions {
  x: number
  y: number
  targetName: string
  targetRect?: TargetRect
}

export interface ClarifyMountOptions {
  element?: HTMLDivElement
  pendingSession: Promise<SubmissionSessionResponse | null>
  onRetrySubmission: () => Promise<SubmissionSessionResponse | null>
  initiatingKeydown?: KeyboardEvent
}

/**
 * The controller-side verbs a mode may perform. Each verb owns one concrete
 * mount, unmount, or hand-off; the states own which verbs run for which input
 * in which mode. Kept as an interface (implemented by WidgetController) so the
 * coupling between the machine and its resources is written down in one place.
 */
export interface ModeHost {
  transitionTo(next: ModeState): void
  exitAll(): void
  dismissFrustrationPrompt(): void
  /** True once the annotation toolbar is mounted — the flow chrome exists. */
  hasAnnotationChrome(): boolean
  /** First entry into markup: font warmup, toolbar, drawing surface, mobile strip. */
  mountAnnotationChrome(): void
  ensureSession(): void
  destroySession(): void
  clearCurrentAnnotation(): void
  teardownDrawBar(): void
  destroyRecordingManager(): void
  startRecorder(): void
  stopRecordingIntoNote(): void
  cancelDraw(): void
  mountDrawBar(): void
  mountDrawSheet(): void
  refreshDrawBar(): void
  mountNotePopup(opts: NotePopupOptions): void
  /** Abandon the note popup without ending the flow: surface, scrim and scroll lock come down, annotating resumes. */
  dismissNotePopup(): void
  /** Dismiss the success card from the previous submission. */
  dismissSuccess(): void
  mountClarifyCard(pos: { x: number; y: number } | null, opts: ClarifyMountOptions): void
  revertToolbarDuringClarify(): void
  releaseClarifyUi(): void
}

/**
 * One object per widget mode. The controller holds a single `state` reference
 * and delegates every mode-dependent input here; transitions run through
 * `transitionTo(next)`, which calls the outgoing state's exit() before the
 * incoming state's enter().
 *
 * enter() mounts what the mode itself needs. exit() is deliberately thin: the
 * toolbar and the annotation session span the whole flow (annotating through
 * clarifying), and several out-edges hand a resource to the next mode instead
 * of releasing it — the note popup's element becomes the clarify card, a
 * stopped recording becomes the submit payload. Those edges release or hand
 * off through their own named paths (cancelDraw, the submit teardown, exitAll),
 * and exitAll remains the universal release every abandon route ends in.
 */
export interface ModeState {
  readonly kind: ModeKind
  /** Whether the docked launcher renders lit while this mode is active. */
  readonly launcherLit: boolean
  /** Whether a frustration signal may surface its prompt in this mode. */
  readonly acceptsFrustrationPrompt: boolean
  enter(): void
  exit(): void
  /** Public API open(). Only idle acts; while open it is an idempotent no-op. */
  handleOpen(): void
  handleClose(): void
  handleEscape(event: KeyboardEvent): void
  handleTabClick(): void
  handleToolbarModeChange(mode: ToolbarMode): void
  /** A stroke landed on the annotation overlay. */
  handleDrawStroke(): void
}

function consume(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

abstract class BaseModeState implements ModeState {
  abstract readonly kind: ModeKind
  readonly launcherLit: boolean = true
  readonly acceptsFrustrationPrompt: boolean = false

  constructor(protected host: ModeHost) {}

  enter(): void {}
  exit(): void {}
  handleOpen(): void {}
  handleClose(): void {
    this.host.exitAll()
  }
  handleEscape(_event: KeyboardEvent): void {}
  handleTabClick(): void {
    this.host.exitAll()
  }
  handleToolbarModeChange(_mode: ToolbarMode): void {}
  handleDrawStroke(): void {}
}

export class IdleState extends BaseModeState {
  readonly kind = 'idle'
  override readonly launcherLit = false
  override readonly acceptsFrustrationPrompt = true

  override handleOpen(): void {
    this.host.dismissFrustrationPrompt()
    this.host.dismissSuccess()
    this.host.transitionTo(new AnnotatingState(this.host))
  }

  override handleClose(): void {
    // Already closed; nothing to exit.
  }

  // Escape falls through untouched (not consumed) so the host page's own
  // Escape handling still works while the widget shows nothing.

  override handleTabClick(): void {
    this.handleOpen()
  }
}

export class AnnotatingState extends BaseModeState {
  readonly kind = 'annotating'

  override enter(): void {
    if (!this.host.hasAnnotationChrome()) {
      this.host.mountAnnotationChrome()
      return
    }
    // Resuming markup from recording, a cancelled drawing, or the note popup:
    // the toolbar survived, only the mode-specific surfaces change hands.
    this.host.destroyRecordingManager()
    this.host.teardownDrawBar()
    this.host.ensureSession()
  }

  // exit: the toolbar and session deliberately outlive this state — they span
  // the whole flow and are released by the flow-ending paths, not per mode.

  override handleEscape(event: KeyboardEvent): void {
    consume(event)
    this.host.exitAll()
  }

  override handleToolbarModeChange(mode: ToolbarMode): void {
    if (mode === 'record') {
      this.host.transitionTo(new RecordingState(this.host))
    } else {
      // Re-entering markup is idempotent: enter() finds the chrome and session
      // already in place and changes nothing.
      this.host.transitionTo(new AnnotatingState(this.host))
    }
  }

  override handleDrawStroke(): void {
    // The draw note bar packs a field, undo/redo, cancel and submit into one
    // pill at the bottom of the screen — which on a phone is exactly where the
    // keyboard lands, and none of it is thumb-sized. Touch collects the note in
    // the same bottom sheet the pin flow already uses.
    this.host.transitionTo(new DrawingState(this.host, isTouchPointer() ? 'sheet' : 'bar'))
  }
}

export class RecordingState extends BaseModeState {
  readonly kind = 'recording'

  override enter(): void {
    // Recording exists to capture the user reproducing something, which the
    // pin and draw surfaces would sit on top of — they come down first.
    this.host.clearCurrentAnnotation()
    this.host.teardownDrawBar()
    this.host.destroySession()
    this.host.startRecorder()
  }

  override handleEscape(event: KeyboardEvent): void {
    // Escape here is the Stop button, not a cancel: the recording is kept and
    // the note popup opens, exactly as if the reporter had pressed Stop. The
    // recording itself is carried into the popup for the submit payload, so
    // this edge hands the manager off instead of destroying it.
    consume(event)
    this.host.stopRecordingIntoNote()
  }

  override handleToolbarModeChange(mode: ToolbarMode): void {
    // A second press of Record must not restart the session already running.
    if (mode === 'record') return
    this.host.transitionTo(new AnnotatingState(this.host))
  }
}

export class DrawingState extends BaseModeState {
  readonly kind = 'drawing'

  // Which note surface collects the drawing's note: the inline bar on a
  // desktop, the bottom sheet on touch.
  constructor(host: ModeHost, private surface: 'bar' | 'sheet') {
    super(host)
  }

  override enter(): void {
    if (this.surface === 'sheet') {
      this.host.mountDrawSheet()
    } else {
      this.host.mountDrawBar()
      this.host.refreshDrawBar()
    }
  }

  override handleEscape(event: KeyboardEvent): void {
    // One Escape costs the stroke, not the session: back to annotating.
    consume(event)
    this.host.cancelDraw()
  }

  override handleToolbarModeChange(mode: ToolbarMode): void {
    if (mode === 'record') {
      this.host.transitionTo(new RecordingState(this.host))
    } else {
      this.host.transitionTo(new AnnotatingState(this.host))
    }
  }

  override handleDrawStroke(): void {
    // Additional strokes while the note surface is already up only need the
    // undo/redo affordances refreshed; the sheet has none.
    if (this.surface === 'bar') this.host.refreshDrawBar()
  }
}

export class PopupState extends BaseModeState {
  readonly kind = 'popup'

  constructor(host: ModeHost, private opts: NotePopupOptions) {
    super(host)
  }

  override enter(): void {
    this.host.mountNotePopup(this.opts)
  }

  override handleEscape(event: KeyboardEvent): void {
    consume(event)
    this.host.exitAll()
  }

  override handleToolbarModeChange(mode: ToolbarMode): void {
    if (mode === 'record') {
      // The popup and its scrim deliberately stay up: stopping the recording
      // opens a fresh note popup whose mount replaces both, so exactly one
      // scrim exists throughout instead of an orphaned pair.
      this.host.transitionTo(new RecordingState(this.host))
    } else {
      // Markup has no successor surface to replace the popup, so it must come
      // down here. Left standing it is a zombie: a scrim and scroll lock the
      // reporter cannot see past, and a checkbox whose change listener keeps
      // writing screenshot consent for a note that was just abandoned.
      this.host.dismissNotePopup()
      this.host.transitionTo(new AnnotatingState(this.host))
    }
  }
}

export class ClarifyingState extends BaseModeState {
  readonly kind = 'clarifying'

  constructor(
    host: ModeHost,
    private pos: { x: number; y: number } | null,
    private opts: ClarifyMountOptions,
  ) {
    super(host)
  }

  override enter(): void {
    this.host.mountClarifyCard(this.pos, this.opts)
  }

  override handleEscape(_event: KeyboardEvent): void {
    // Deliberate no-op: the card holds an in-flight submission, and only its
    // header X cancels. Escape falls through unconsumed so the host page keeps
    // its own Escape handling.
  }

  override handleToolbarModeChange(_mode: ToolbarMode): void {
    // The toolbar stays visible during clarification but must not start a new
    // surface under the conversation — snap its visual back to the mode the
    // submission came from.
    this.host.revertToolbarDuringClarify()
  }
}

export class SubmittingState extends BaseModeState {
  readonly kind = 'submitting'
  override readonly launcherLit = false

  override enter(): void {
    // Both entries converge here: skipping the clarification drops its chrome,
    // and re-entering from a failure-card retry finds it already gone — every
    // release below is idempotent.
    this.host.releaseClarifyUi()
  }

  override handleTabClick(): void {
    // Deliberate no-op: the launcher must not start a second feedback on top
    // of the one still finalizing in the background.
  }

  // Escape falls through unconsumed: nothing is on screen to dismiss, and the
  // background finalize must not be cancellable by a stray keypress.
}
