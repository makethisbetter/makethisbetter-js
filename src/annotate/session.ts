import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { Annotation } from '../types'
import { AnnotationOverlay } from './overlay'
import { ElementHighlighter } from './highlighter'
import { getElementName, getCssSelector, elementUnderPoint } from '../context/dom-utils'
import { captureAnchorOffset } from '../screenshot/geometry'
import { PinMarker } from './pin'
import { DrawLayer } from './draw'
import { isTouchPointer } from '../widget/pointer-kind'
import { isPrivacyProtected, structuralElementName, structuralElementSelector } from '../privacy/dom'

// How far the pointer must travel before the gesture counts as drawing rather
// than pointing. Roughly the slop browsers themselves allow between mousedown
// and click, and comfortably above the jitter a resting finger produces.
const DRAW_MIN_TRAVEL_PX = 10

interface SessionHandlers {
  onPin: (annotation: Annotation, targetName: string) => void
  onDrawStroke: () => void
}

function annotationTarget(element: Element): { name: string; text: string; selector: string } {
  if (isPrivacyProtected(element)) {
    return {
      name: structuralElementName(element),
      text: '',
      selector: structuralElementSelector(element),
    }
  }

  return {
    name: getElementName(element),
    text: element.textContent?.trim().slice(0, 200) ?? '',
    selector: getCssSelector(element),
  }
}

export class AnnotationSession {
  private overlay: AnnotationOverlay
  private highlighter: ElementHighlighter
  private pinMarker: PinMarker
  private drawLayer: DrawLayer
  private interactionActive = true
  private pendingHighlightFrame: number | null = null
  private lastMoveX = 0
  private lastMoveY = 0
  // Read once. A pointer kind does not change mid-session, and re-querying it
  // per gesture would let a mid-stroke media-query flip strand a stroke.
  private readonly touch = isTouchPointer()

  constructor(
    shadow: ShadowContainer,
    private messages: I18nMessages,
    private handlers: SessionHandlers,
  ) {
    this.highlighter = new ElementHighlighter(shadow)
    this.pinMarker = new PinMarker(shadow)
    this.drawLayer = new DrawLayer(shadow)
    this.overlay = new AnnotationOverlay(shadow, {
      onPointerDown: (e) => this.handlePointerDown(e),
      onPointerMove: (e) => this.handlePointerMove(e),
      onPointerUp: (e) => this.handlePointerUp(e),
      // Previously mouseleave. The overlay now captures the pointer, so a
      // stroke no longer ends by wandering off the surface — only by the
      // browser taking the gesture away, which is what pointercancel means.
      onPointerCancel: () => {
        if (this.drawLayer.isCurrentlyDrawing()) this.finishStroke()
        this.cancelPendingHighlight()
        this.highlighter.hide()
      },
    })
  }

  private handlePointerDown(e: PointerEvent): void {
    e.preventDefault()
    this.drawLayer.startDraw(e.clientX, e.clientY)
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.drawLayer.isCurrentlyDrawing()) {
      this.cancelPendingHighlight()
      this.drawLayer.continueDraw(e.clientX, e.clientY)
      this.highlighter.hide()
      return
    }

    this.lastMoveX = e.clientX
    this.lastMoveY = e.clientY
    if (this.pendingHighlightFrame !== null) return
    this.pendingHighlightFrame = requestAnimationFrame(() => {
      this.pendingHighlightFrame = null
      this.updateHighlight()
    })
  }

  private updateHighlight(): void {
    if (!this.interactionActive || this.drawLayer.isCurrentlyDrawing() || this.drawSessionActive()) return
    const underEl = elementUnderPoint(this.lastMoveX, this.lastMoveY)
    if (underEl) this.highlighter.highlight(underEl)
    else this.highlighter.hide()
  }

  private cancelPendingHighlight(): void {
    if (this.pendingHighlightFrame === null) return
    cancelAnimationFrame(this.pendingHighlightFrame)
    this.pendingHighlightFrame = null
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.drawLayer.isCurrentlyDrawing()) return
    this.finishStroke(e)
  }

  // A drag that travels far enough becomes a freehand stroke and opens the
  // draw note bar; a tap on an element becomes a pin. Stray taps while a
  // drawing already exists are ignored so they don't hijack the draw flow.
  private finishStroke(e?: PointerEvent): void {
    if (this.drawLayer.getCurrentSpan() >= DRAW_MIN_TRAVEL_PX) {
      this.drawLayer.commitStroke()
      this.highlighter.hide()
      this.handlers.onDrawStroke()
      return
    }

    this.drawLayer.cancelCurrentDraw()
    // A finger draws; it does not point. Hitting a 40px control on a phone is
    // fiddly, and the habit people already have is to scribble over what is
    // wrong rather than tap it precisely. So on touch a tap means nothing at
    // all — which also retires a whole family of defects, since every "the tap
    // did nothing" and "a stray dot appeared" report was a tap that carried
    // meaning it should never have carried. The element identity a pin used to
    // supply is recovered from the stroke instead, in getDrawAnnotation().
    if (this.touch) return
    if (this.drawLayer.hasStrokes() || !e) return

    const underEl = elementUnderPoint(e.clientX, e.clientY)
    const target = underEl ? annotationTarget(underEl) : null
    const targetName = target?.name ?? this.messages.annotation.element
    const rect = underEl?.getBoundingClientRect()
    // Sampled here, alongside the coordinates it belongs to. Read any later and
    // it would describe wherever the reporter has scrolled to since.
    const anchor = captureAnchorOffset(underEl)
    const annotation: Annotation = {
      type: 'pin',
      x: e.clientX,
      y: e.clientY,
      targetSelector: target?.selector,
      targetText: target?.text ?? '',
      targetName,
      targetRect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom } : undefined,
      captureOffsetX: anchor.x,
      captureOffsetY: anchor.y,
    }
    this.pinMarker.addPin(e.clientX, e.clientY)
    this.highlighter.select()
    this.handlers.onPin(annotation, targetName)
  }

  undoDraw(): void {
    this.drawLayer.undo()
  }

  redoDraw(): void {
    this.drawLayer.redo()
  }

  canUndoDraw(): boolean {
    return this.drawLayer.canUndo()
  }

  canRedoDraw(): boolean {
    return this.drawLayer.canRedo()
  }

  hasDrawStrokes(): boolean {
    return this.drawLayer.hasStrokes()
  }

  private drawSessionActive(): boolean {
    return this.drawLayer.hasStrokes() || this.drawLayer.canRedo()
  }

  // The stroke carries the element identity a pin used to supply. Without it a
  // touch report would say only "the user drew somewhere", where the board has
  // always been able to say which control they meant — that identity is what
  // makes a report actionable, and it should not be the price of not making
  // people aim. Resolved from the stroke's centre, so a circle drawn around a
  // button lands inside it. Best effort by design: an underline sits below its
  // target and will miss, which is why the drawing itself is still the record.
  getDrawAnnotation(): Annotation | null {
    const annotation = this.drawLayer.getAnnotation()
    if (!annotation) return null

    // The drawing's coordinates are in the frame it was drawn in; hit-testing
    // reads the page as it is now, so the centre has to make that trip first.
    const drift = this.drawLayer.viewportDrift()
    const underEl = elementUnderPoint(annotation.x - drift.x, annotation.y - drift.y)
    if (!underEl) return annotation

    // The rect and its own anchor are read in the same breath, so together they
    // say where this element sits in the capture; subtracting the drawing's
    // anchor restates that in the frame the rest of the annotation uses.
    const rect = underEl.getBoundingClientRect()
    const anchor = captureAnchorOffset(underEl)
    const dx = anchor.x - (annotation.captureOffsetX ?? 0)
    const dy = anchor.y - (annotation.captureOffsetY ?? 0)
    const target = annotationTarget(underEl)
    return {
      ...annotation,
      targetSelector: target.selector,
      targetText: target.text,
      targetName: target.name,
      targetRect: {
        top: rect.top + dy,
        left: rect.left + dx,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom + dy,
      },
    }
  }

  clearDraw(): void {
    this.drawLayer.clearAll()
  }

  dismissInteraction(): void {
    if (!this.interactionActive) return
    this.interactionActive = false
    this.cancelPendingHighlight()
    this.overlay.destroy()
  }

  hideHighlight(): void {
    this.highlighter.hide()
  }

  destroy(): void {
    this.dismissInteraction()
    this.highlighter.destroy()
    this.pinMarker.destroy()
    this.drawLayer.destroy()
  }
}
