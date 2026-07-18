import { afterEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { DrawLayer } from './draw'

const SVG_SEL = 'svg[class="mtb-draw-svg"]'

describe('DrawLayer', () => {
  let shadow: ShadowContainer
  let onDrawComplete: ReturnType<typeof vi.fn>
  let draw: DrawLayer

  function setup() {
    shadow = new ShadowContainer()
    onDrawComplete = vi.fn()
    draw = new DrawLayer(shadow, onDrawComplete)
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

  describe('startDraw', () => {
    it('creates a path element in the SVG', () => {
      setup()
      draw.startDraw(10, 20)
      const path = shadow.root.querySelector(`${SVG_SEL} path`)
      expect(path).toBeTruthy()
      expect(path!.tagName).toBe('path')
    })

    it('sets isCurrentlyDrawing to true', () => {
      setup()
      expect(draw.isCurrentlyDrawing()).toBe(false)
      draw.startDraw(10, 20)
      expect(draw.isCurrentlyDrawing()).toBe(true)
    })

    it('initializes point count to 1', () => {
      setup()
      draw.startDraw(10, 20)
      expect(draw.getPointCount()).toBe(1)
    })
  })

  describe('continueDraw', () => {
    it('adds points and updates the path d attribute', () => {
      setup()
      draw.startDraw(10, 20)
      draw.continueDraw(30, 40)
      const path = shadow.root.querySelector(`${SVG_SEL} path`)!
      expect(path.getAttribute('d')).toContain('M 10 20')
      expect(path.getAttribute('d')).toContain('L 30 40')
      expect(draw.getPointCount()).toBe(2)
    })

    it('does nothing when not drawing', () => {
      setup()
      draw.continueDraw(30, 40)
      expect(draw.getPointCount()).toBe(0)
    })
  })

  describe('endDraw', () => {
    it('calls onDrawComplete with a draw annotation when enough points', () => {
      setup()
      draw.startDraw(0, 0)
      draw.continueDraw(10, 10)
      draw.endDraw()

      expect(onDrawComplete).toHaveBeenCalledOnce()
      const annotation = onDrawComplete.mock.calls[0][0]
      expect(annotation.type).toBe('draw')
      expect(annotation.drawPath).toContain('M 0 0')
      expect(annotation.drawPath).toContain('L 10 10')
      expect(annotation.x).toBe(5)
      expect(annotation.y).toBe(5)
    })

    it('removes the path and does not call callback with fewer than 2 points', () => {
      setup()
      draw.startDraw(10, 20)
      draw.endDraw()

      expect(onDrawComplete).not.toHaveBeenCalled()
      expect(draw.isCurrentlyDrawing()).toBe(false)
    })

    it('does nothing when not currently drawing', () => {
      setup()
      draw.endDraw()
      expect(onDrawComplete).not.toHaveBeenCalled()
    })

    it('sets isCurrentlyDrawing to false after ending', () => {
      setup()
      draw.startDraw(0, 0)
      draw.continueDraw(10, 10)
      draw.endDraw()
      expect(draw.isCurrentlyDrawing()).toBe(false)
    })
  })

  describe('clearAll', () => {
    it('removes all SVG children and resets state', () => {
      setup()
      draw.startDraw(0, 0)
      draw.continueDraw(10, 10)
      draw.clearAll()

      expect(shadow.root.querySelector(SVG_SEL)!.childElementCount).toBe(0)
      expect(draw.isCurrentlyDrawing()).toBe(false)
      expect(draw.getPointCount()).toBe(0)
    })
  })

  describe('cancelCurrentDraw', () => {
    it('removes the current path and resets drawing state', () => {
      setup()
      draw.startDraw(0, 0)
      draw.continueDraw(10, 10)
      draw.cancelCurrentDraw()

      expect(draw.isCurrentlyDrawing()).toBe(false)
      expect(draw.getPointCount()).toBe(0)
      const svg = shadow.root.querySelector(SVG_SEL)!
      expect(svg.querySelector('path')).toBeNull()
    })

    it('is safe to call when not drawing', () => {
      setup()
      expect(() => draw.cancelCurrentDraw()).not.toThrow()
    })
  })

  describe('destroy', () => {
    it('removes the SVG element from the shadow root', () => {
      setup()
      draw.destroy()
      expect(shadow.root.querySelector(SVG_SEL)).toBeNull()
    })
  })

  describe('getCenter calculation', () => {
    it('computes the center of the bounding box of all points', () => {
      setup()
      draw.startDraw(0, 0)
      draw.continueDraw(100, 0)
      draw.continueDraw(100, 100)
      draw.continueDraw(0, 100)
      draw.endDraw()

      const annotation = onDrawComplete.mock.calls[0][0]
      expect(annotation.x).toBe(50)
      expect(annotation.y).toBe(50)
    })
  })
})
