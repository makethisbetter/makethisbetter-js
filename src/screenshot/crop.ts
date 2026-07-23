import type { Annotation } from '../types'
import { parsePathPolylines } from './capture'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const MIN_CROP_WIDTH = 400
const MIN_CROP_HEIGHT = 300
const PADDING_PX = 150
const PADDING_RATIO = 0.3
const SKIP_CROP_RATIO = 0.85

export function getAnnotationBounds(annotations: Annotation[]): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const ann of annotations) {
    if (ann.type === 'pin') {
      minX = Math.min(minX, ann.x)
      minY = Math.min(minY, ann.y)
      maxX = Math.max(maxX, ann.x)
      maxY = Math.max(maxY, ann.y)
      if (ann.targetRect) {
        const r = ann.targetRect
        minX = Math.min(minX, r.left)
        minY = Math.min(minY, r.top)
        maxX = Math.max(maxX, r.left + r.width)
        maxY = Math.max(maxY, r.bottom)
      }
    } else if (ann.type === 'draw' && ann.drawPath) {
      for (const polyline of parsePathPolylines(ann.drawPath)) {
        for (const [x, y] of polyline) {
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
  }

  if (!isFinite(minX) || !isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

export function computeCropRegion(
  annotations: Annotation[],
  viewportWidth: number,
  viewportHeight: number,
): CropRect | null {
  const bounds = getAnnotationBounds(annotations)
  if (!bounds) return null

  const padX = Math.max(PADDING_PX, viewportWidth * PADDING_RATIO)
  const padY = Math.max(PADDING_PX, viewportHeight * PADDING_RATIO)

  let x = bounds.minX - padX
  let y = bounds.minY - padY
  let w = (bounds.maxX - bounds.minX) + padX * 2
  let h = (bounds.maxY - bounds.minY) + padY * 2

  if (w < MIN_CROP_WIDTH) {
    x -= (MIN_CROP_WIDTH - w) / 2
    w = MIN_CROP_WIDTH
  }
  if (h < MIN_CROP_HEIGHT) {
    y -= (MIN_CROP_HEIGHT - h) / 2
    h = MIN_CROP_HEIGHT
  }

  x = Math.max(0, x)
  y = Math.max(0, y)
  w = Math.min(w, viewportWidth - x)
  h = Math.min(h, viewportHeight - y)

  if (w >= viewportWidth * SKIP_CROP_RATIO && h >= viewportHeight * SKIP_CROP_RATIO) {
    return null
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h),
  }
}

export function cropCanvas(source: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement {
  const cropped = document.createElement('canvas')
  cropped.width = rect.width
  cropped.height = rect.height
  const ctx = cropped.getContext('2d')
  if (ctx) {
    ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  }
  return cropped
}

export async function cropDataUrl(dataUrl: string, rect: CropRect): Promise<string> {
  const image = await loadImageForCrop(dataUrl)
  if (!image) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function loadImageForCrop(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}
