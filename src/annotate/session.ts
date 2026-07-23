import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { Annotation } from '../types'
import { AnnotationOverlay } from './overlay'
import { ElementHighlighter, getElementName, getCssSelector } from './highlighter'
import { PinMarker } from './pin'
import { DrawLayer } from './draw'

const DRAW_MIN_POINTS = 5

interface SessionHandlers {
  onPin: (annotation: Annotation, targetName: string) => void
  onDrawStroke: () => void
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

  constructor(
    shadow: ShadowContainer,
    private messages: I18nMessages,
    private handlers: SessionHandlers,
  ) {
    this.highlighter = new ElementHighlighter(shadow)
    this.pinMarker = new PinMarker(shadow)
    this.drawLayer = new DrawLayer(shadow)
    this.overlay = new AnnotationOverlay(shadow, {
      onMouseDown: (e) => this.handleMouseDown(e),
      onMouseMove: (e) => this.handleMouseMove(e),
      onMouseUp: (e) => this.handleMouseUp(e),
      onMouseLeave: () => {
        if (this.drawLayer.isCurrentlyDrawing()) this.finishStroke()
        this.cancelPendingHighlight()
        this.highlighter.hide()
      },
    })
  }

  private handleMouseDown(e: MouseEvent): void {
    e.preventDefault()
    this.drawLayer.startDraw(e.clientX, e.clientY)
  }

  private handleMouseMove(e: MouseEvent): void {
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
    const underEl = getElementUnder(this.lastMoveX, this.lastMoveY)
    if (underEl) this.highlighter.highlight(underEl)
    else this.highlighter.hide()
  }

  private cancelPendingHighlight(): void {
    if (this.pendingHighlightFrame === null) return
    cancelAnimationFrame(this.pendingHighlightFrame)
    this.pendingHighlightFrame = null
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.drawLayer.isCurrentlyDrawing()) return
    this.finishStroke(e)
  }

  // A drag past the point threshold becomes a freehand stroke and opens the
  // draw note bar; a tap on an element becomes a pin. Stray taps while a
  // drawing already exists are ignored so they don't hijack the draw flow.
  private finishStroke(e?: MouseEvent): void {
    if (this.drawLayer.getCurrentPointCount() >= DRAW_MIN_POINTS) {
      this.drawLayer.commitStroke()
      this.highlighter.hide()
      this.handlers.onDrawStroke()
      return
    }

    this.drawLayer.cancelCurrentDraw()
    if (this.drawLayer.hasStrokes() || !e) return

    const underEl = getElementUnder(e.clientX, e.clientY)
    const targetName = underEl ? getElementName(underEl) : this.messages.annotation.element
    const rect = underEl?.getBoundingClientRect()
    const annotation: Annotation = {
      type: 'pin',
      x: e.clientX,
      y: e.clientY,
      targetSelector: underEl ? getCssSelector(underEl) : undefined,
      targetText: underEl?.textContent?.trim().slice(0, 200) ?? '',
      targetName,
      targetRect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom } : undefined,
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

  getDrawAnnotation(): Annotation | null {
    return this.drawLayer.getAnnotation()
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

// Skips the widget host via elementsFromPoint instead of toggling its
// display — hiding the host on every mousemove flickered the toolbar.
function getElementUnder(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find(el => el.id !== 'mtb-widget-host') ?? null
}
