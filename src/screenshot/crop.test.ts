import { describe, expect, it } from 'vitest'
import { computeCropRegion, getAnnotationBounds } from './crop'
import type { Annotation } from '../types'

describe('getAnnotationBounds', () => {
  it('returns null for empty annotations', () => {
    expect(getAnnotationBounds([])).toBeNull()
  })

  it('returns pin point as bounds', () => {
    const annotations: Annotation[] = [{ type: 'pin', x: 100, y: 200 }]
    expect(getAnnotationBounds(annotations)).toEqual({
      minX: 100, minY: 200, maxX: 100, maxY: 200,
    })
  })

  it('includes targetRect in pin bounds', () => {
    const annotations: Annotation[] = [{
      type: 'pin', x: 150, y: 120,
      targetRect: { top: 100, left: 80, width: 200, height: 50, bottom: 150 },
    }]
    const bounds = getAnnotationBounds(annotations)!
    expect(bounds.minX).toBe(80)
    expect(bounds.minY).toBe(100)
    expect(bounds.maxX).toBe(280)
    expect(bounds.maxY).toBe(150)
  })

  it('computes bounds from draw path points', () => {
    const annotations: Annotation[] = [{
      type: 'draw', x: 50, y: 50,
      drawPath: 'M 10 20 L 90 80 L 50 60',
    }]
    const bounds = getAnnotationBounds(annotations)!
    expect(bounds.minX).toBe(10)
    expect(bounds.minY).toBe(20)
    expect(bounds.maxX).toBe(90)
    expect(bounds.maxY).toBe(80)
  })

  it('unions bounds across multiple annotations', () => {
    const annotations: Annotation[] = [
      { type: 'pin', x: 100, y: 200 },
      { type: 'pin', x: 500, y: 50 },
    ]
    const bounds = getAnnotationBounds(annotations)!
    expect(bounds.minX).toBe(100)
    expect(bounds.minY).toBe(50)
    expect(bounds.maxX).toBe(500)
    expect(bounds.maxY).toBe(200)
  })

  it('returns null for draw annotation with no path', () => {
    const annotations: Annotation[] = [{ type: 'draw', x: 50, y: 50 }]
    expect(getAnnotationBounds(annotations)).toBeNull()
  })
})

describe('computeCropRegion', () => {
  it('returns null for empty annotations', () => {
    expect(computeCropRegion([], 1920, 1080)).toBeNull()
  })

  it('adds padding around a small annotation', () => {
    const annotations: Annotation[] = [{ type: 'pin', x: 500, y: 400 }]
    const rect = computeCropRegion(annotations, 1920, 1080)!
    expect(rect).not.toBeNull()
    expect(rect.x).toBeLessThan(500)
    expect(rect.y).toBeLessThan(400)
    expect(rect.width).toBeGreaterThan(MIN_CROP_W)
    expect(rect.height).toBeGreaterThan(MIN_CROP_H)
  })

  it('enforces minimum crop dimensions', () => {
    const annotations: Annotation[] = [{ type: 'pin', x: 500, y: 400 }]
    const rect = computeCropRegion(annotations, 1920, 1080)!
    expect(rect.width).toBeGreaterThanOrEqual(400)
    expect(rect.height).toBeGreaterThanOrEqual(300)
  })

  it('clamps crop to image bounds', () => {
    const annotations: Annotation[] = [{ type: 'pin', x: 5, y: 5 }]
    const rect = computeCropRegion(annotations, 1920, 1080)!
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(1920)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1080)
  })

  it('returns null when annotation covers most of the viewport', () => {
    const annotations: Annotation[] = [{
      type: 'draw', x: 960, y: 540,
      drawPath: 'M 10 10 L 1910 10 L 1910 1070 L 10 1070',
    }]
    const rect = computeCropRegion(annotations, 1920, 1080)
    expect(rect).toBeNull()
  })

  it('uses 30% padding when viewport is large enough', () => {
    const annotations: Annotation[] = [{ type: 'pin', x: 960, y: 540 }]
    const rect = computeCropRegion(annotations, 2000, 2000)!
    // 30% of 2000 = 600, which is > 150px fixed padding
    // So crop width should be at least 600*2 = 1200
    expect(rect.width).toBeGreaterThanOrEqual(1200)
    expect(rect.height).toBeGreaterThanOrEqual(1200)
  })

  it('handles annotation near bottom-right edge', () => {
    const annotations: Annotation[] = [{ type: 'pin', x: 1900, y: 1060 }]
    const rect = computeCropRegion(annotations, 1920, 1080)!
    expect(rect.x + rect.width).toBeLessThanOrEqual(1920)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1080)
  })

  it('crops a draw annotation to its stroke bounds', () => {
    const annotations: Annotation[] = [{
      type: 'draw', x: 350, y: 250,
      drawPath: 'M 300 200 L 400 300',
    }]
    const rect = computeCropRegion(annotations, 1920, 1080)!
    expect(rect).not.toBeNull()
    expect(rect.x).toBeLessThan(300)
    expect(rect.y).toBeLessThan(200)
    expect(rect.x + rect.width).toBeGreaterThan(400)
    expect(rect.y + rect.height).toBeGreaterThan(300)
  })
})

const MIN_CROP_W = 400
const MIN_CROP_H = 300
