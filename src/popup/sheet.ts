import { KeyboardInset } from './keyboard-inset'

/**
 * Matches the `max-width: 480px` block in widget.css, where every panel that
 * holds a text field stops being a card anchored near the annotation and
 * becomes a bottom sheet.
 */
export const SHEET_MAX_WIDTH = 480

export function isSheetViewport(): boolean {
  return window.innerWidth <= SHEET_MAX_WIDTH
}

/**
 * Hands a panel's geometry to the stylesheet on narrow screens, and keeps it
 * clear of the software keyboard.
 *
 * Two jobs that have to live together. The panels each position themselves
 * with inline `left`/`top`, which would beat the media query and drag the sheet
 * back into a floating card — so the inline values have to be cleared, not just
 * overridden. And a `position: fixed` sheet gets no help from the browser's
 * scroll-into-view, which only moves elements in the document flow, so the
 * keyboard simply covers it unless something lifts it.
 *
 * Shared by the comment popup, the clarify card, and the draw note bar: all
 * three carry a text field, and all three are the last thing between a reporter
 * and a submitted report.
 */
export class SheetLayout {
  private inset = new KeyboardInset()

  constructor(private el: HTMLElement) {}

  /** Returns true when this took over layout, i.e. the caller should not position. */
  apply(): boolean {
    if (!isSheetViewport()) return false

    this.el.style.left = ''
    this.el.style.top = ''
    this.el.style.maxHeight = ''
    this.lift(this.inset.current())
    this.inset.observe((px) => this.lift(px))
    return true
  }

  release(): void {
    this.inset.stop()
  }

  /**
   * Lifting is clamped so the panel's own top edge stays on screen.
   *
   * The rule is geometric rather than a guess about how tall a keyboard gets:
   * an earlier version refused any inset above 60% of the window, a number
   * calibrated from a single reading on a single device. What actually matters
   * is that the reporter can still see and reach the panel, and that is a
   * question about this panel's height, which is known right here.
   */
  private lift(inset: number): void {
    const headroom = Math.max(0, window.innerHeight - this.el.offsetHeight)
    const applied = Math.min(inset, headroom)
    this.el.style.bottom = applied > 0 ? `${applied}px` : ''
  }
}
