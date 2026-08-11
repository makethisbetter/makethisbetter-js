import type { Annotation, WidgetBrandColors } from '../types'
import { BLOCK_CLASS, MASK_TEXT_CLASS } from '../privacy/dom'
import { WIDGET_HOST_ID } from '../context/dom-utils'
import { filterInputValue, isSensitiveField } from '../privacy/fields'
import { filterSensitiveText } from '../privacy/sanitize'
import { createSensitiveTextContext, hasSensitiveTextContext } from '../privacy/text-context'
import { BRAND_COLOR } from '../styles'
import { anchorScreenshotOffset, captureTransform, nestedScrollOffset, parentElement, rectToCanvas, toCanvasX, toCanvasY, viewportCaptureRect } from './geometry'
import type { CaptureTransform, Rect, ScrollOffset } from './geometry'
import { loadImage } from './image'
import { parsePathPolylines, translatePathD } from './svg-path'

// Capture at CSS pixels (pixelRatio 1) as JPEG to keep the upload small: on
// retina screens the default devicePixelRatio would quadruple the pixel count,
// and the model downscales past ~1568px anyway. The capture covers only the
// viewport; capturePixelRatio stays as a guard for a viewport that would ever
// exceed the browser's canvas ceiling.
//
// Annotations are baked onto the captured bitmap with canvas 2D afterwards —
// never mounted into the live page — so the capture leaves the page visually
// untouched no matter how long the DOM snapshot takes.
export interface BaseScreenshot {
  dataUrl: string
  metrics: Rect
  redactions: Rect[]
  /**
   * Where the page was scrolled when the bitmap was measured. The bake happens
   * later — the reporter is still typing — so it cannot read this itself, and
   * annotations that carry their own anchor need it to come back to this
   * capture's frame.
   */
  pageScroll: ScrollOffset
}

// html-to-image is the largest dependency in the bundle, and most sessions
// never open the widget, let alone capture a screenshot. Loading it lazily
// keeps it out of the first-injection payload for ESM/CJS consumers (the IIFE
// build inlines the import back into its single file). warmFontEmbedCss is the
// first caller on every capture path, so the popup-open warm-up that prefetches
// the font CSS also prefetches this module and submit latency does not regress.
type HtmlToImageModule = typeof import('html-to-image')

let htmlToImageLoaded: Promise<HtmlToImageModule> | null = null

function loadHtmlToImage(): Promise<HtmlToImageModule> {
  if (htmlToImageLoaded) return htmlToImageLoaded
  // A rejection must not stay cached: one flaky-network failure would otherwise
  // make every later capture fail instantly until the page reloads. Same
  // reset-on-failure as record/session.ts loadRrweb.
  htmlToImageLoaded = import('html-to-image').catch((err) => {
    htmlToImageLoaded = null
    throw err
  })
  return htmlToImageLoaded
}

// Embedding webfonts is the expensive half of a capture: html-to-image walks
// every stylesheet and fetches each referenced font file — a hundred-odd
// requests on a Google-Fonts page — on every capture. The font set does not
// change while the page lives, so compute the embed CSS once and reuse it.
let fontEmbedCss: string | undefined
let fontEmbedCssRequest: Promise<string | undefined> | null = null

export function warmFontEmbedCss(): Promise<string | undefined> {
  if (fontEmbedCss !== undefined) return Promise.resolve(fontEmbedCss)
  // On failure fall back to undefined so toJpeg embeds fonts itself, and allow
  // a later capture to try warming again.
  fontEmbedCssRequest ??= loadHtmlToImage()
    .then(({ getFontEmbedCSS }) => getFontEmbedCSS(document.body))
    .then((css) => {
      fontEmbedCss = css
      return css
    })
    .catch(() => {
      fontEmbedCssRequest = null
      return undefined
    })
  return fontEmbedCssRequest
}

// The rasterized page without annotations. Annotations are baked afterwards
// from data, so this half can run early — during a pause in the reporter's
// typing — and the submit path only pays for the cheap bake.
//
// Everything below this margin past the viewport is culled from the clone and
// never rasterized. A full-page capture rasterized a tall page — sometimes 10x
// the pixels and DOM nodes — only for the bake to crop it back to roughly a
// viewport, and that wasted work is what froze typing on heavy pages.
//
// Only content BELOW the viewport can go: removing in-flow content above it
// collapses the clone's layout upward and breaks the scroll alignment the
// transform relies on (verified: culling above + translate rendered an
// entirely blank capture).
const CULL_MARGIN_PX = 200
// The browser cannot read cross-origin images whose server omits CORS headers.
// Replace only that resource in html-to-image's clone so one inaccessible image
// cannot discard the rest of the privacy-filtered screenshot.
const TRANSPARENT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export type ScreenshotResourceUrlResolver = (
  resourceUrl: string,
  contentType?: string,
) => string | undefined | Promise<string | undefined>

export async function captureBaseScreenshot(
  resourceUrlResolver?: ScreenshotResourceUrlResolver,
  signal?: AbortSignal,
): Promise<BaseScreenshot | null> {
  try {
    if (signal?.aborted) return null
    // The module load rides alongside the warm-up (which itself needs the
    // module); a load failure rejects here and fails the capture closed to
    // null, same as any other capture error.
    const [{ toJpeg }, fontEmbedCSS] = await Promise.all([loadHtmlToImage(), warmFontEmbedCss()])
    // toJpeg clones the entire DOM synchronously and blocks the main thread
    // for 1-2 seconds on complex pages. Yielding here lets pending API
    // responses resolve first so the clarification request fires before the
    // heavy capture work rather than being queued behind it.
    await new Promise<void>(r => setTimeout(r, 0))
    if (signal?.aborted) return null
    // Measure only after the font warm-up settles: a cold warm-up is long
    // enough (a hundred-odd requests) for late-arriving fonts to reflow the
    // page, and a cover measured before that shift lands on the wrong pixels
    // with no fail-closed signal.
    const bodyRect = document.body.getBoundingClientRect()
    const metrics = viewportCaptureRect()
    const pageScroll = { x: window.scrollX, y: window.scrollY }
    const redactions = collectPrivacyRedactions(document.body)
    const dataUrl = await toJpeg(document.body, {
      quality: 0.85,
      imagePlaceholder: TRANSPARENT_IMAGE_PLACEHOLDER,
      resourceUrlResolver,
      fetchRequestInit: signal ? { signal } : undefined,
      width: metrics.width,
      height: metrics.height,
      pixelRatio: capturePixelRatio(metrics),
      backgroundColor: '#ffffff',
      skipFonts: false,
      skipAutoScale: false,
      fontEmbedCSS,
      style: {
        // The clone lays out from the document top; shifting it by the body's
        // current viewport offset puts the scrolled-to region at the canvas
        // origin, so live viewport measurements map onto the bitmap 1:1.
        transform: `translate(${bodyRect.left}px, ${bodyRect.top}px)`,
        transformOrigin: 'top left',
      },
      filter: (node) => {
        if (node instanceof HTMLElement && node.id === WIDGET_HOST_ID) return false
        if (!(node instanceof Element)) return true
        const rect = node.getBoundingClientRect()
        // Zero-sized nodes carry no pixels but often carry styles or heads of
        // rendered subtrees (style/script/positioned wrappers) — keep them.
        if (rect.width === 0 && rect.height === 0) return true
        // The clone walk is asynchronous, so the page can scroll while it
        // runs — and a live rect.top is measured against wherever the page is
        // by then. Re-expressing it against the scroll this capture was framed
        // at keeps the cull decision stable however late the walk reads it.
        const topInCapture = rect.top + window.scrollY - pageScroll.y
        return topInCapture <= metrics.height + CULL_MARGIN_PX
      },
    })
    if (signal?.aborted) return null
    return { dataUrl, metrics, redactions, pageScroll }
  } catch {
    return null
  }
}

export async function bakeAnnotatedScreenshot(
  base: BaseScreenshot,
  annotations: Annotation[] = [],
  brandColors?: WidgetBrandColors,
): Promise<Blob | null> {
  try {
    const screenshotAnnotations = annotations.map(
      annotation => translateAnnotationForScreenshot(annotation, base.pageScroll),
    )
    return await bakeScreenshot(base.dataUrl, screenshotAnnotations, base.metrics, base.redactions, brandColors)
  } catch {
    return null
  }
}

export async function captureScreenshot(
  annotations: Annotation[] = [],
  brandColors?: WidgetBrandColors,
): Promise<Blob | null> {
  const base = await captureBaseScreenshot()
  if (!base) return null
  return bakeAnnotatedScreenshot(base, annotations, brandColors)
}

// html-to-image clones an element's children at their unscrolled positions.
// Annotations, however, are recorded in viewport coordinates. Translate the
// screenshot-only copy so it remains attached to its target in that clone;
// the original annotation is still sent to the API unchanged.
//
// The capture is one viewport — the one on screen at capture time, which the
// prime-at-annotation flow makes the viewport the first annotation was made in.
// An annotation whose anchor puts it outside that rect simply is not in the
// shot: its strokes land off-canvas and the canvas clips them silently. That is
// the honest picture (the marked content was not captured), and the wire
// annotation data still carries the mark for the board.
function translateAnnotationForScreenshot(annotation: Annotation, pageScroll: ScrollOffset): Annotation {
  const offset = screenshotOffset(annotation, pageScroll)
  if (offset.x === 0 && offset.y === 0) return annotation

  return {
    ...annotation,
    x: annotation.x + offset.x,
    y: annotation.y + offset.y,
    targetRect: annotation.targetRect && {
      ...annotation.targetRect,
      top: annotation.targetRect.top + offset.y,
      left: annotation.targetRect.left + offset.x,
      bottom: annotation.targetRect.bottom + offset.y,
    },
    drawPath: annotation.drawPath && translatePathD(annotation.drawPath, offset.x, offset.y),
  }
}

/**
 * How far to move an annotation to land where the capture rendered its target.
 *
 * An annotation that recorded its own anchor already knows where it belongs in
 * clone space, so all that is left is coming back to the frame this capture was
 * measured in — no live DOM read, and therefore nothing that a scroll between
 * the annotation and the capture can spoil.
 *
 * Without that anchor (an older client, or replayed data) the only thing left to
 * do is measure the target now and hope nothing moved, which is what every
 * annotation used to do.
 */
function screenshotOffset(annotation: Annotation, pageScroll: ScrollOffset): ScrollOffset {
  if (annotation.captureOffsetX !== undefined && annotation.captureOffsetY !== undefined) {
    return anchorScreenshotOffset(
      { x: annotation.captureOffsetX, y: annotation.captureOffsetY },
      pageScroll,
    )
  }

  return nestedScrollOffset(findAnnotationTarget(annotation))
}

function findAnnotationTarget(annotation: Annotation): Element | null {
  if (annotation.targetSelector) {
    try {
      const target = document.querySelector(annotation.targetSelector)
      if (target) return target
    } catch {
      // Selectors are captured from the page, so a later DOM change can make
      // one invalid. Fall back to the element beneath the annotation instead.
    }
  }

  return document.elementsFromPoint?.(annotation.x, annotation.y)[0] ?? null
}

async function bakeScreenshot(
  dataUrl: string,
  annotations: Annotation[],
  captureMetrics: Rect,
  redactions: Rect[],
  brandColors?: WidgetBrandColors,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const image = await loadImage(dataUrl)
  if (!image) return null

  canvas.width = image.naturalWidth || window.innerWidth
  canvas.height = image.naturalHeight || window.innerHeight
  ctx.drawImage(image, 0, 0)
  const transform = captureTransform(captureMetrics, canvas.width, canvas.height)

  ctx.fillStyle = '#e5e7eb'
  for (const rect of redactions) {
    const cover = rectToCanvas(transform, rect)
    ctx.fillRect(cover.left, cover.top, cover.width, cover.height)
  }

  for (const annotation of annotations) {
    if (annotation.type === 'draw' && annotation.drawPath) {
      drawStroke(ctx, annotation.drawPath, transform, brandColors?.primary)
    } else if (annotation.type === 'pin') {
      drawPin(
        ctx,
        toCanvasX(transform, annotation.x),
        toCanvasY(transform, annotation.y),
        brandColors,
      )
    }
  }

  // No crop step: the capture rect is the viewport, which is exactly the
  // deliverable. Cropping this bitmap could only ever remove captured pixels —
  // and cropping content above the visible band was the bug class that shifted
  // the remaining content up and blanked the shot.
  return canvasToJpegBlob(canvas)
}

function collectPrivacyRedactions(root: HTMLElement): Rect[] {
  const redactions: Rect[] = []
  for (const element of elementsIncludingRoot(root, `.${BLOCK_CLASS}`)) {
    addRedaction(redactions, element.getBoundingClientRect(), cloneScrollOffset(element))
  }

  for (const element of root.querySelectorAll('input, textarea, select')) {
    if (isWidgetOrBlocked(element)) continue
    const value = element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      ? element.value
      : ''
    const isMasked = element.closest(`.${MASK_TEXT_CLASS}`) !== null
    const hasSensitiveValue = isSensitiveField(element) || filterInputValue(value, element) !== value
    if (!isMasked && !hasSensitiveValue) continue
    addRedaction(redactions, element.getBoundingClientRect(), cloneScrollOffset(element), REDACTION_PADDING_PX)
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textContext = createSensitiveTextContext()
  let node = walker.nextNode()
  while (node) {
    const parent = node.parentElement
    const text = node.textContent ?? ''
    const isMasked = parent?.closest(`.${MASK_TEXT_CLASS}`) !== null
    const hasSensitiveText = filterSensitiveText(text) !== text || hasSensitiveTextContext(node, textContext)
    if (parent && !isWidgetOrBlocked(parent) && (isMasked || hasSensitiveText)) {
      // Text is the parent's content, so the parent's own scrollTop moves it
      // too — start the offset walk at the parent itself, not its ancestors.
      const offset = nestedScrollOffset(parent)
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        addRedaction(redactions, rect, offset, REDACTION_PADDING_PX)
      }
    }
    node = walker.nextNode()
  }

  return redactions
}

// html-to-image clones a scroller's children back at their unscrolled
// positions, so a cover measured from the live viewport rect of an element
// inside a scrolled container would land away from the secret in the export
// and leave it visible — the same drift the annotation path compensates in
// translateAnnotationForScreenshot. A border box moves with ancestor scroll
// only (an element's own scrollTop shifts its content, not its box), so the
// walk starts at the parent; page scroll stays out because nestedScrollOffset
// stops at body, whose offset captureMetrics already carries.
function cloneScrollOffset(element: Element): { x: number; y: number } {
  return nestedScrollOffset(parentElement(element))
}

function elementsIncludingRoot(root: HTMLElement, selector: string): Element[] {
  const descendants = Array.from(root.querySelectorAll(selector))
  return root.matches(selector) ? [root, ...descendants] : descendants
}

function isWidgetOrBlocked(element: Element): boolean {
  return element.closest(`#${WIDGET_HOST_ID}`) !== null || element.closest(`.${BLOCK_CLASS}`) !== null
}

function addRedaction(
  redactions: Rect[],
  rect: DOMRect,
  offset: { x: number; y: number },
  padding = 0,
): void {
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) {
    throw new Error('Invalid privacy redaction geometry')
  }
  if (rect.width <= 0 || rect.height <= 0) return
  redactions.push({
    left: rect.left + offset.x - padding,
    top: rect.top + offset.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  })
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  drawPath: string,
  transform: CaptureTransform,
  color = BRAND_COLOR,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const points of parsePathPolylines(drawPath)) {
    if (points.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(
      toCanvasX(transform, points[0][0]),
      toCanvasY(transform, points[0][1]),
    )
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(
        toCanvasX(transform, points[i][0]),
        toCanvasY(transform, points[i][1]),
      )
    }
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)'
    ctx.lineWidth = 7
    ctx.stroke()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 5.5
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 3.5
    ctx.stroke()
  }
  ctx.restore()
}

// Safari refuses to back a canvas larger than roughly 16.7M pixels and hands
// back a blank one instead, and the caller's catch turns that into a silent
// screenshot-less submission. A viewport should never get near the ceiling,
// but the guard costs nothing and keeps an absurd embedder viewport rendered
// smaller instead of not at all; bakeScreenshot derives its scale from the
// returned bitmap, so annotations follow along.
const MAX_CAPTURE_PIXELS = 16_000_000
const REDACTION_PADDING_PX = 2

function capturePixelRatio(metrics: Rect): number {
  const total = metrics.width * metrics.height
  if (!Number.isFinite(total) || total <= MAX_CAPTURE_PIXELS) return 1
  return Math.sqrt(MAX_CAPTURE_PIXELS / total)
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  brandColors?: WidgetBrandColors,
): void {
  const primary = brandColors?.primary ?? BRAND_COLOR
  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.68)'
  ctx.shadowOffsetY = 2
  ctx.shadowBlur = 8
  ctx.fillStyle = primary
  ctx.beginPath()
  ctx.arc(x, y, 11, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.restore()
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
