import type { ShadowContainer } from '../widget/shadow'
import type { Annotation } from '../types'
import { DRAW_STROKE } from '../styles'

type Point = [number, number]

interface Stroke {
  path: SVGPathElement
  d: string
  points: Point[]
}

export class DrawLayer {
  private svg: SVGSVGElement
  private currentPath: SVGPathElement | null = null
  private currentPoints: Point[] = []
  private isDrawing = false
  private committed: Stroke[] = []
  private redoStack: { d: string; points: Point[] }[] = []

  constructor(shadow: ShadowContainer) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'mtb-draw-svg')
    shadow.append(this.svg)
  }

  startDraw(x: number, y: number): void {
    this.isDrawing = true
    this.currentPoints = [[x, y]]
    this.currentPath = this.createPath()
    this.svg.appendChild(this.currentPath)
  }

  continueDraw(x: number, y: number): void {
    if (!this.isDrawing || !this.currentPath) return
    this.currentPoints.push([x, y])
    this.currentPath.setAttribute('d', buildPathD(this.currentPoints))
  }

  // Commits the in-progress stroke to the undo stack and clears the redo stack.
  // Callers decide whether the stroke has enough points before committing.
  commitStroke(): boolean {
    if (!this.isDrawing || !this.currentPath) return false
    this.isDrawing = false
    this.committed.push({ path: this.currentPath, d: buildPathD(this.currentPoints), points: this.currentPoints })
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
    this.redoStack.push({ d: stroke.d, points: stroke.points })
    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    const path = this.createPath()
    path.setAttribute('d', entry.d)
    this.svg.appendChild(path)
    this.committed.push({ path, d: entry.d, points: entry.points })
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
    if (this.committed.length === 0) return null
    const points = this.committed.flatMap(s => s.points)
    const [cx, cy] = center(points)
    return {
      type: 'draw',
      x: cx,
      y: cy,
      drawPath: this.committed.map(s => s.d).join(' '),
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

  getCurrentPointCount(): number {
    return this.currentPoints.length
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

function center(points: Point[]): Point {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return [cx, cy]
}
