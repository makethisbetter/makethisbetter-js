import { toJpeg } from 'html-to-image'
import type { Annotation } from '../types'

// Capture at CSS pixels (pixelRatio 1) as JPEG to keep the upload small: on
// retina screens the default devicePixelRatio would quadruple the pixel count,
// and the model downscales past ~1568px anyway.
export async function captureScreenshot(annotations: Annotation[] = []): Promise<Blob | null> {
  const annotationLayer = mountCaptureAnnotations(annotations)

  try {
    const dataUrl = await toJpeg(document.body, {
      quality: 0.85,
      pixelRatio: 1,
      backgroundColor: '#ffffff',
      cacheBust: true,
      skipAutoScale: false,
      filter: (node) => {
        if (node instanceof HTMLElement && node.id === 'mtb-widget-host') return false
        return true
      },
    })
    return dataUrlToBlob(dataUrl)
  } catch {
    return null
  } finally {
    annotationLayer?.remove()
  }
}

function mountCaptureAnnotations(annotations: Annotation[]): HTMLDivElement | null {
  if (annotations.length === 0) return null

  const layer = document.createElement('div')
  layer.setAttribute('data-mtb-capture-annotations', 'true')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645;'

  for (const [index, annotation] of annotations.entries()) {
    if (annotation.type === 'pin') {
      layer.appendChild(buildCapturePin(annotation, index + 1))
    } else if (annotation.type === 'draw' && annotation.drawPath) {
      layer.appendChild(buildCaptureDraw(annotation.drawPath))
    }
  }

  document.body.appendChild(layer)
  return layer
}

function buildCapturePin(annotation: Annotation, index: number): HTMLDivElement {
  const pin = document.createElement('div')
  pin.textContent = String(index)
  pin.style.cssText = [
    'position:fixed',
    `left:${annotation.x}px`,
    `top:${annotation.y}px`,
    'width:22px',
    'height:22px',
    'border-radius:50% 50% 50% 2px',
    'background:#059669',
    'border:2px solid #fff',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font:700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'color:#fff',
    'box-shadow:0 2px 8px rgba(5,150,105,0.45)',
    'transform:translate(-50%,-50%)',
  ].join(';')
  return pin
}

function buildCaptureDraw(drawPath: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`)
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;overflow:visible;'

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', drawPath)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', '#059669')
  path.setAttribute('stroke-width', '3.5')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  path.setAttribute('filter', 'drop-shadow(0 1px 2px rgba(5,150,105,0.35))')
  svg.appendChild(path)

  return svg
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
