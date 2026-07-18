import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { Annotation } from '../types'
import { AnnotationOverlay } from './overlay'
import { ElementHighlighter, getElementName, getCssSelector } from './highlighter'
import { PinMarker } from './pin'
import { DrawLayer } from './draw'

const DRAW_MIN_POINTS = 5

export class AnnotationSession {
  private overlay: AnnotationOverlay
  private highlighter: ElementHighlighter
  private pinMarker: PinMarker
  private drawLayer: DrawLayer
  private pinCount = 0
  private interactionActive = true
  private pendingHighlightFrame: number | null = null
  private lastMoveX = 0
  private lastMoveY = 0

  constructor(
    shadow: ShadowContainer,
    private messages: I18nMessages,
    private onReady: (annotation: Annotation, targetName: string) => void,
  ) {
    this.highlighter = new ElementHighlighter(shadow)
    this.pinMarker = new PinMarker(shadow)
    this.drawLayer = new DrawLayer(shadow, (annotation) => {
      this.onReady(annotation, this.messages.annotation.drawing)
    })
    this.overlay = new AnnotationOverlay(shadow, {
      onMouseDown: (e) => this.handleMouseDown(e),
      onMouseMove: (e) => this.handleMouseMove(e),
      onMouseUp: (e) => this.handleMouseUp(e),
      onMouseLeave: () => {
        if (this.drawLayer.isCurrentlyDrawing()) this.drawLayer.endDraw()
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
    if (!this.interactionActive || this.drawLayer.isCurrentlyDrawing()) return
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

    if (this.drawLayer.getPointCount() >= DRAW_MIN_POINTS) {
      this.drawLayer.endDraw()
      return
    }

    this.drawLayer.cancelCurrentDraw()
    const underEl = getElementUnder(e.clientX, e.clientY)
    const targetName = underEl ? getElementName(underEl) : this.messages.annotation.element
    const annotation: Annotation = {
      type: 'pin',
      x: e.clientX,
      y: e.clientY,
      targetSelector: underEl ? getCssSelector(underEl) : undefined,
      targetText: underEl?.textContent?.trim().slice(0, 200) ?? '',
      targetName,
    }
    this.pinMarker.addPin(e.clientX, e.clientY, ++this.pinCount)
    this.drawLayer.clearAll()
    this.highlighter.hide()
    this.onReady(annotation, targetName)
  }

  dismissInteraction(): void {
    if (!this.interactionActive) return
    this.interactionActive = false
    this.cancelPendingHighlight()
    this.overlay.destroy()
    this.highlighter.destroy()
  }

  destroy(): void {
    this.dismissInteraction()
    this.pinMarker.destroy()
    this.drawLayer.destroy()
  }
}

// Skips the widget host via elementsFromPoint instead of toggling its
// display — hiding the host on every mousemove flickered the toolbar.
function getElementUnder(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find(el => el.id !== 'mtb-widget-host') ?? null
}
