import type { ShadowContainer } from '../widget/shadow'
import type { Annotation } from '../types'
import { DRAW_STROKE } from '../styles'

export class DrawLayer {
  private svg: SVGSVGElement
  private path: SVGPathElement | null = null
  private points: [number, number][] = []
  private isDrawing = false
  private onDrawComplete: (annotation: Annotation) => void

  constructor(shadow: ShadowContainer, onDrawComplete: (annotation: Annotation) => void) {
    this.onDrawComplete = onDrawComplete

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'mtb-draw-svg')
    shadow.append(this.svg)
  }

  startDraw(x: number, y: number): void {
    this.isDrawing = true
    this.points = [[x, y]]

    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.path.setAttribute('fill', 'none')
    this.path.setAttribute('stroke', DRAW_STROKE.color)
    this.path.setAttribute('stroke-width', DRAW_STROKE.width)
    this.path.setAttribute('stroke-linecap', DRAW_STROKE.linecap)
    this.path.setAttribute('stroke-linejoin', DRAW_STROKE.linejoin)
    this.path.setAttribute('style', `filter:${DRAW_STROKE.filter}`)
    this.svg.appendChild(this.path)
  }

  continueDraw(x: number, y: number): void {
    if (!this.isDrawing || !this.path) return
    this.points.push([x, y])
    this.path.setAttribute('d', this.buildPathD())
  }

  endDraw(): void {
    if (!this.isDrawing || this.points.length < 2) {
      this.isDrawing = false
      if (this.path) {
        this.path.remove()
        this.path = null
      }
      return
    }
    this.isDrawing = false

    const center = this.getCenter()
    const pathD = this.buildPathD()

    const annotation: Annotation = {
      type: 'draw',
      x: center[0],
      y: center[1],
      drawPath: pathD,
    }

    this.onDrawComplete(annotation)
  }

  private buildPathD(): string {
    if (this.points.length === 0) return ''
    const [fx, fy] = this.points[0]
    let d = `M ${fx} ${fy}`
    for (let i = 1; i < this.points.length; i++) {
      const [x, y] = this.points[i]
      d += ` L ${x} ${y}`
    }
    return d
  }

  private getCenter(): [number, number] {
    const xs = this.points.map(p => p[0])
    const ys = this.points.map(p => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    return [cx, cy]
  }

  clearAll(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild)
    this.path = null
    this.isDrawing = false
    this.points = []
  }

  cancelCurrentDraw(): void {
    this.path?.remove()
    this.path = null
    this.isDrawing = false
    this.points = []
  }

  isCurrentlyDrawing(): boolean {
    return this.isDrawing
  }

  getPointCount(): number {
    return this.points.length
  }

  destroy(): void {
    this.svg.remove()
  }
}
