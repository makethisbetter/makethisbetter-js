import { toJpeg } from 'html-to-image'
import type { Annotation } from '../types'
import { BRAND_COLOR, FONT_STACK } from '../styles'

// Capture at CSS pixels (pixelRatio 1) as JPEG to keep the upload small: on
// retina screens the default devicePixelRatio would quadruple the pixel count,
// and the model downscales past ~1568px anyway.
//
// Annotations are baked onto the captured bitmap with canvas 2D afterwards —
// never mounted into the live page — so the capture leaves the page visually
// untouched no matter how long the DOM snapshot takes.
export async function captureScreenshot(annotations: Annotation[] = []): Promise<Blob | null> {
  try {
    const dataUrl = await toJpeg(document.body, {
      quality: 0.85,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
      skipFonts: true,
      skipAutoScale: false,
      filter: (node) => {
        if (node instanceof HTMLElement && node.id === 'mtb-widget-host') return false
        return true
      },
    })
    if (annotations.length > 0) {
      const annotated = await bakeAnnotations(dataUrl, annotations)
      if (annotated) return annotated
    }
    return dataUrlToBlob(dataUrl)
  } catch {
    return null
  }
}

async function bakeAnnotations(dataUrl: string, annotations: Annotation[]): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const image = await loadImage(dataUrl)
  if (!image) return null

  canvas.width = image.naturalWidth || window.innerWidth
  canvas.height = image.naturalHeight || window.innerHeight
  ctx.drawImage(image, 0, 0)
  const scaleX = canvas.width / window.innerWidth
  const scaleY = canvas.height / window.innerHeight

  let pinIndex = 0
  for (const annotation of annotations) {
    if (annotation.type === 'draw' && annotation.drawPath) {
      drawStroke(ctx, annotation.drawPath, scaleX, scaleY)
    } else if (annotation.type === 'pin') {
      drawPin(ctx, annotation.x * scaleX, annotation.y * scaleY, ++pinIndex)
    }
  }

  return canvasToJpegBlob(canvas)
}

function drawStroke(ctx: CanvasRenderingContext2D, drawPath: string, scaleX: number, scaleY: number): void {
  ctx.save()
  ctx.strokeStyle = BRAND_COLOR
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(5,150,105,0.35)'
  ctx.shadowOffsetY = 1
  ctx.shadowBlur = 2
  for (const points of parsePathPolylines(drawPath)) {
    if (points.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(points[0][0] * scaleX, points[0][1] * scaleY)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * scaleX, points[i][1] * scaleY)
    ctx.stroke()
  }
  ctx.restore()
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, index: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(5,150,105,0.45)'
  ctx.shadowOffsetY = 2
  ctx.shadowBlur = 8
  ctx.fillStyle = BRAND_COLOR
  ctx.beginPath()
  ctx.arc(x, y, 11, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 10px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(index), x, y)
  ctx.restore()
}

// The draw layer only ever emits M/L polyline commands (see buildPathD in
// annotate/draw.ts); anything else in the string is ignored.
export function parsePathPolylines(drawPath: string): Array<Array<[number, number]>> {
  const polylines: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> | null = null
  const tokens = drawPath.match(/[ML]\s*[-\d.]+\s+[-\d.]+/g) ?? []
  for (const token of tokens) {
    const [x, y] = token.slice(1).trim().split(/\s+/).map(Number)
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    if (token[0] === 'M') {
      current = [[x, y]]
      polylines.push(current)
    } else if (current) {
      current.push([x, y])
    }
  }
  return polylines
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85)
    } catch {
      resolve(null)
    }
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}
