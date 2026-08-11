// The capture pipeline works in clone-space: viewport rects corrected for
// nested-scroll drift, i.e. where html-to-image renders each element in the
// captured bitmap. Capture metrics and privacy covers are the same kind of
// rectangle in that one space, so they share this spelling. Crop rectangles
// (viewport / canvas pixels) stay a separate type on purpose — the space
// difference is information.
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

// Owns the offset+scale math from clone-space onto the rendered canvas, so
// callers stop hand-writing (v - left) * scaleX at every layer. left/top is
// the clone origin inside the capture; scale is capture CSS px → canvas px.
export interface CaptureTransform {
  left: number
  top: number
  scaleX: number
  scaleY: number
}

export function captureTransform(region: Rect, canvasWidth: number, canvasHeight: number): CaptureTransform {
  return {
    left: region.left,
    top: region.top,
    scaleX: canvasWidth / region.width,
    scaleY: canvasHeight / region.height,
  }
}

export function toCanvasX(transform: CaptureTransform, x: number): number {
  return (x - transform.left) * transform.scaleX
}

export function toCanvasY(transform: CaptureTransform, y: number): number {
  return (y - transform.top) * transform.scaleY
}

export function rectToCanvas(transform: CaptureTransform, rect: Rect): Rect {
  return {
    left: toCanvasX(transform, rect.left),
    top: toCanvasY(transform, rect.top),
    width: rect.width * transform.scaleX,
    height: rect.height * transform.scaleY,
  }
}

export interface ScrollOffset {
  x: number
  y: number
}

/**
 * The capture region: the visual viewport, and nothing else. html-to-image
 * renders document.body shifted by the page scroll so the on-screen region
 * lands at the canvas origin — which makes this rect both the capture request
 * and the deliverable. There is no crop step: cropping a clone-space bitmap
 * was only ever needed when the capture was the whole document.
 */
export function viewportCaptureRect(): Rect {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

/**
 * How far an anchored annotation must move to land in a capture's frame.
 *
 * The anchor is the annotation's scroll debt at creation (page + nested
 * scrollers); the capture's pageScroll is the page half of that debt at capture
 * time. Adding the anchor lifts the annotation into clone space, subtracting
 * the capture scroll brings it back down into the viewport bitmap.
 */
export function anchorScreenshotOffset(
  anchor: ScrollOffset,
  pageScroll: ScrollOffset,
): ScrollOffset {
  return { x: anchor.x - pageScroll.x, y: anchor.y - pageScroll.y }
}

// How far a viewport measurement has to move to reach clone space: every
// scroller between the element and the body has pushed its content out of view
// by its own scrollLeft/scrollTop, and html-to-image renders it back.
export function nestedScrollOffset(target: Element | null): ScrollOffset {
  let x = 0
  let y = 0
  let current = target

  while (current && current !== document.body) {
    if (current instanceof HTMLElement) {
      x += current.scrollLeft
      y += current.scrollTop
    }
    current = parentElement(current)
  }

  return { x, y }
}

export function parentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement

  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

/**
 * The full offset from a viewport measurement to clone space, page scroll
 * included — the anchor an annotation records so that later scrolling cannot
 * move it.
 *
 * nestedScrollOffset stops at the body because the capture's own metrics carry
 * the page scroll for anything measured at capture time. An annotation is not
 * measured at capture time, so it has to carry that half itself.
 */
export function captureAnchorOffset(target: Element | null): ScrollOffset {
  const nested = nestedScrollOffset(target)
  return { x: nested.x + window.scrollX, y: nested.y + window.scrollY }
}
