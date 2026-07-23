import { afterEach, describe, it, expect } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { DrawLayer } from './draw'

const SVG_SEL = 'svg[class="mtb-draw-svg"]'

describe('DrawLayer', () => {
  let shadow: ShadowContainer
  let draw: DrawLayer

  function setup() {
    shadow = new ShadowContainer()
    draw = new DrawLayer(shadow)
  }

  function stroke(points: [number, number][]): void {
    draw.startDraw(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) draw.continueDraw(points[i][0], points[i][1])
    draw.commitStroke()
  }

  afterEach(() => {
    draw.destroy()
    shadow.destroy()
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('appends an SVG element to the shadow root', () => {
      setup()
      const svg = shadow.root.querySelector(SVG_SEL)
      expect(svg).toBeTruthy()
      expect(svg!.tagName).toBe('svg')
    })
  })

  describe('startDraw / continueDraw', () => {
    it('creates a path and tracks the current point count', () => {
      setup()
      draw.startDraw(10, 20)
      expect(draw.isCurrentlyDrawing()).toBe(true)
      expect(draw.getCurrentPointCount()).toBe(1)
      draw.continueDraw(30, 40)
      const path = shadow.root.querySelector(`${SVG_SEL} path`)!
      expect(path.getAttribute('d')).toContain('M 10 20')
      expect(path.getAttribute('d')).toContain('L 30 40')
      expect(draw.getCurrentPointCount()).toBe(2)
    })

    it('continueDraw does nothing when not drawing', () => {
      setup()
      draw.continueDraw(30, 40)
      expect(draw.getCurrentPointCount()).toBe(0)
    })
  })

  describe('commitStroke', () => {
    it('commits the current stroke and makes it available for the annotation', () => {
      setup()
      stroke([[0, 0], [10, 10]])
      expect(draw.isCurrentlyDrawing()).toBe(false)
      expect(draw.hasStrokes()).toBe(true)
      const annotation = draw.getAnnotation()!
      expect(annotation.type).toBe('draw')
      expect(annotation.drawPath).toContain('M 0 0')
      expect(annotation.drawPath).toContain('L 10 10')
      expect(annotation.x).toBe(5)
      expect(annotation.y).toBe(5)
    })

    it('returns false when not drawing', () => {
      setup()
      expect(draw.commitStroke()).toBe(false)
    })
  })

  describe('undo / redo', () => {
    it('undo removes the last committed stroke and redo restores it', () => {
      setup()
      stroke([[0, 0], [10, 10]])
      stroke([[20, 20], [30, 30]])
      expect(shadow.root.querySelectorAll(`${SVG_SEL} path`).length).toBe(2)

      expect(draw.undo()).toBe(true)
      expect(shadow.root.querySelectorAll(`${SVG_SEL} path`).length).toBe(1)
      expect(draw.canRedo()).toBe(true)

      expect(draw.redo()).toBe(true)
      expect(shadow.root.querySelectorAll(`${SVG_SEL} path`).length).toBe(2)
      expect(draw.canRedo()).toBe(false)
    })

    it('undo/redo are no-ops on empty stacks', () => {
      setup()
      expect(draw.undo()).toBe(false)
      expect(draw.redo()).toBe(false)
    })

    it('committing a new stroke clears the redo stack', () => {
      setup()
      stroke([[0, 0], [10, 10]])
      draw.undo()
      expect(draw.canRedo()).toBe(true)
      stroke([[40, 40], [50, 50]])
      expect(draw.canRedo()).toBe(false)
    })
  })

  describe('getAnnotation', () => {
    it('returns null when there are no committed strokes', () => {
      setup()
      expect(draw.getAnnotation()).toBeNull()
    })

    it('combines multiple strokes into one draw path with a joint center', () => {
      setup()
      stroke([[0, 0], [100, 0]])
      stroke([[0, 100], [100, 100]])
      const annotation = draw.getAnnotation()!
      expect(annotation.drawPath!.match(/M /g)!.length).toBe(2)
      expect(annotation.x).toBe(50)
      expect(annotation.y).toBe(50)
    })
  })

  describe('cancelCurrentDraw', () => {
    it('removes the in-progress path but keeps committed strokes', () => {
      setup()
      stroke([[0, 0], [10, 10]])
      draw.startDraw(50, 50)
      draw.cancelCurrentDraw()
      expect(draw.isCurrentlyDrawing()).toBe(false)
      expect(draw.hasStrokes()).toBe(true)
      expect(shadow.root.querySelectorAll(`${SVG_SEL} path`).length).toBe(1)
    })
  })

  describe('clearAll', () => {
    it('removes all strokes and resets undo/redo', () => {
      setup()
      stroke([[0, 0], [10, 10]])
      draw.undo()
      draw.clearAll()
      expect(shadow.root.querySelector(SVG_SEL)!.childElementCount).toBe(0)
      expect(draw.hasStrokes()).toBe(false)
      expect(draw.canUndo()).toBe(false)
      expect(draw.canRedo()).toBe(false)
    })
  })

  describe('destroy', () => {
    it('removes the SVG element from the shadow root', () => {
      setup()
      draw.destroy()
      expect(shadow.root.querySelector(SVG_SEL)).toBeNull()
    })
  })
})
