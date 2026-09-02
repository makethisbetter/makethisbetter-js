import type { ShadowContainer } from '../widget/shadow'
import type { Annotation } from '../types'
import { DRAW_STROKE } from '../styles'
import { elementUnderPoint } from '../context/dom-utils'
import { nestedScrollOffset } from '../screenshot/geometry'
import type { ScrollOffset } from '../screenshot/geometry'

type Point = [number, number]

interface StrokeAnchor {
  /** Page scroll plus enclosing-container scroll: the offset to clone space. */
  offset: ScrollOffset
  /** The page-scroll half on its own, kept so viewportDrift can undo it. */
  pageScroll: ScrollOffset
}

interface Stroke {
  path: SVGPathElement
  d: string
  points: Point[]
  anchor: StrokeAnchor
}

export class DrawLayer {
  private svg: SVGSVGElement
  private currentPath: SVGPathElement | null = null
  private currentPoints: Point[] = []
  // Sampled when the stroke starts rather than when the drawing is handed over,
  // so a page or container scroll partway through a multi-stroke drawing moves
  // neither the strokes already made nor the ones still to come.
  private currentAnchor: StrokeAnchor = emptyAnchor()
  private isDrawing = false
  private committed: Stroke[] = []
  private redoStack: { d: string; points: Point[]; anchor: StrokeAnchor }[] = []

  constructor(shadow: ShadowContainer) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'mtb-draw-svg')
    shadow.append(this.svg)
  }

  startDraw(x: number, y: number): void {
    this.isDrawing = true
    this.currentPoints = [[x, y]]
    this.currentAnchor = strokeAnchor(x, y)
    this.currentPath = this.createPath()
    this.svg.appendChild(this.currentPath)
  }

  continueDraw(x: number, y: number): void {
    if (!this.isDrawing || !this.currentPath) return
    this.currentPoints.push([x, y])
    this.currentPath.setAttribute('d', buildPathD(this.currentPoints))
  }

  /**
   * How far the pointer has wandered from where it went down, in pixels.
   *
   * This is what separates a tap from a stroke. Counting points cannot: a
   * mouse click reports no movement at all, while a finger reports a burst of
   * sub-pixel jitter, so any point-based threshold reads every tap on a phone
   * as a drawing.
   */
  getCurrentSpan(): number {
    const [start] = this.currentPoints
    if (!start) return 0

    let max = 0
    for (const [x, y] of this.currentPoints) {
      max = Math.max(max, Math.hypot(x - start[0], y - start[1]))
    }
    return max
  }

  // Commits the in-progress stroke to the undo stack and clears the redo stack.
  // Callers decide whether the stroke has enough points before committing.
  commitStroke(): boolean {
    if (!this.isDrawing || !this.currentPath) return false
    this.isDrawing = false
    this.committed.push({
      path: this.currentPath,
      d: buildPathD(this.currentPoints),
      points: this.currentPoints,
      anchor: this.currentAnchor,
    })
    this.redoStack = []
    this.currentPath = null
    this.currentPoints = []
    return true
  }

  cancelCurrentDraw(): void {
    this.currentPath?.remove()
    this.currentPath = null
    this.isDrawing = false
    this.currentPoints = []
  }

  undo(): boolean {
    const stroke = this.committed.pop()
    if (!stroke) return false
    stroke.path.remove()
    this.redoStack.push({ d: stroke.d, points: stroke.points, anchor: stroke.anchor })
    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    const path = this.createPath()
    path.setAttribute('d', entry.d)
    this.svg.appendChild(path)
    // The stroke comes back in the frame it was drawn in, not the frame the
    // page happens to be scrolled to when redo is pressed.
    this.committed.push({ path, d: entry.d, points: entry.points, anchor: entry.anchor })
    return true
  }

  canUndo(): boolean {
    return this.committed.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  hasStrokes(): boolean {
    return this.committed.length > 0
  }

  getAnnotation(): Annotation | null {
    const [first] = this.committed
    if (!first) return null

    // Strokes made either side of a scroll were recorded against different
    // viewports. Restate them all in the frame the first stroke was drawn in so
    // the drawing is one shape, and hand that frame's anchor to the caller.
    const strokes = this.committed.map(stroke => shiftPoints(stroke.points, {
      x: stroke.anchor.offset.x - first.anchor.offset.x,
      y: stroke.anchor.offset.y - first.anchor.offset.y,
    }))
    const [cx, cy] = center(strokes.flat())
    return {
      type: 'draw',
      x: cx,
      y: cy,
      drawPath: strokes.map(buildPathD).join(' '),
      captureOffsetX: first.anchor.offset.x,
      captureOffsetY: first.anchor.offset.y,
    }
  }

  /**
   * How far the drawing's frame has drifted from the live viewport, so a caller
   * can map a point in the drawing back onto the page as it stands now — which
   * is what hit-testing the drawing's target needs.
   */
  viewportDrift(): ScrollOffset {
    const [first] = this.committed
    if (!first) return { x: 0, y: 0 }
    return {
      x: window.scrollX - first.anchor.pageScroll.x,
      y: window.scrollY - first.anchor.pageScroll.y,
    }
  }

  clearAll(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild)
    this.currentPath = null
    this.isDrawing = false
    this.currentPoints = []
    this.committed = []
    this.redoStack = []
  }

  isCurrentlyDrawing(): boolean {
    return this.isDrawing
  }

  destroy(): void {
    this.svg.remove()
  }

  private createPath(): SVGPathElement {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', DRAW_STROKE.color)
    path.setAttribute('stroke-width', DRAW_STROKE.width)
    path.setAttribute('stroke-linecap', DRAW_STROKE.linecap)
    path.setAttribute('stroke-linejoin', DRAW_STROKE.linejoin)
    path.setAttribute('style', `filter:${DRAW_STROKE.filter}`)
    return path
  }
}

function buildPathD(points: Point[]): string {
  if (points.length === 0) return ''
  const [fx, fy] = points[0]
  let d = `M ${fx} ${fy}`
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]
    d += ` L ${x} ${y}`
  }
  return d
}

function emptyAnchor(): StrokeAnchor {
  return { offset: { x: 0, y: 0 }, pageScroll: { x: 0, y: 0 } }
}

function strokeAnchor(x: number, y: number): StrokeAnchor {
  const pageScroll = { x: window.scrollX, y: window.scrollY }
  const nested = nestedScrollOffset(elementUnderPoint(x, y))
  return {
    offset: { x: nested.x + pageScroll.x, y: nested.y + pageScroll.y },
    pageScroll,
  }
}

function shiftPoints(points: Point[], offset: ScrollOffset): Point[] {
  if (offset.x === 0 && offset.y === 0) return points
  return points.map(([x, y]) => [x + offset.x, y + offset.y])
}

function center(points: Point[]): Point {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return [cx, cy]
}
