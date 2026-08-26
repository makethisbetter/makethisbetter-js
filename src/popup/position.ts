// Shared floating-panel geometry for the chat card and its kin. Panels anchor
// a fixed panel inside the viewport while keeping clear of the launcher tab;
// the margin and tab reserve used to be duplicated in each class and had to
// stay hand-synced, so they are named once here.

/** Gap kept between a floating panel and every viewport edge. */
export const VIEWPORT_MARGIN = 12
/** Horizontal space reserved for the launcher tab on its side of the screen. */
export const TAB_WIDTH = 32

/**
 * The horizontal band a floating panel may occupy: the viewport minus the edge
 * margin, minus the launcher tab on whichever side it sits.
 */
export interface ViewportFrame {
  vw: number
  vh: number
  minLeft: number
  maxRight: number
}

export function measureViewportFrame(tabPosition: 'left' | 'right'): ViewportFrame {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    vw,
    vh,
    minLeft: VIEWPORT_MARGIN + (tabPosition === 'left' ? TAB_WIDTH : 0),
    maxRight: vw - VIEWPORT_MARGIN - (tabPosition === 'right' ? TAB_WIDTH : 0),
  }
}

/** Widest a panel can be without crossing the edge margin or the launcher tab. */
export function panelWidth(preferred: number, frame: ViewportFrame): number {
  return Math.min(preferred, frame.vw - 2 * VIEWPORT_MARGIN - TAB_WIDTH)
}
