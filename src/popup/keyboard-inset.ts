/**
 * How much of the window the software keyboard is covering.
 *
 * A `position: fixed` sheet gets no help from the browser here — the built-in
 * "scroll the focused field into view" only moves elements that are in the
 * document flow, so on iOS the keyboard simply covers the sheet.
 *
 * The two platforms hide the keyboard in different places, and this one
 * formula covers both. iOS keeps the layout viewport at full height and
 * shrinks (and shifts) the visual viewport, so the difference is the keyboard.
 * Android resizes the layout viewport itself, so `innerHeight` shrinks too and
 * the difference falls out to zero — which is the right answer there, because
 * the bottom of the window is already above the keyboard.
 *
 * `offsetTop` matters as much as `height`: iOS shifts the visual viewport up
 * as well as shrinking it, and ignoring the shift leaves the sheet floating
 * exactly that far off, with a strip of page showing beneath it.
 */

/**
 * The keyboard slides in, and iOS reports the viewport continuously while it
 * moves. Measured on an iOS 18.7 device over 130ms: 660 -> 323 -> 95 -> 660.
 * Acting on each of those walked the sheet up to 337px, then 565px — off the
 * top of the screen — and back down. Waiting for the numbers to stop moving
 * turns that into one placement.
 */
const SETTLE_MS = 140

export class KeyboardInset {
  private onChange: ((inset: number) => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastReading: number | null = null

  private handler = (): void => {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const reading = this.current()
      // Take it only once the viewport says the same thing twice. Mid-slide
      // iOS reports values that are not measurements — -122 and 95 on a 660px
      // window were both seen — and a single quiet moment is not proof the
      // animation has finished, only that events paused. Two agreeing reads
      // are, and cost one more settle interval.
      if (reading === this.lastReading) {
        this.lastReading = null
        this.onChange?.(reading)
        return
      }
      this.lastReading = reading
      this.handler()
    }, SETTLE_MS)
  }

  current(): number {
    const vp = window.visualViewport
    if (!vp) return 0

    // Observed on iOS 18.7 mid-keyboard-animation: height reported as -122.
    // A viewport has no negative height — that is not a small measurement, it
    // is not a measurement. Deriving an inset from it gave 782px on a 660px
    // window, and only the settle window happened to discard it that time.
    if (vp.height <= 0) return 0

    const inset = Math.round(window.innerHeight - (vp.height + vp.offsetTop))
    // The keyboard cannot hide more than the window contains.
    return Math.min(Math.max(0, inset), window.innerHeight)
  }

  observe(onChange: (inset: number) => void): void {
    const vp = window.visualViewport
    if (!vp) return
    this.onChange = onChange
    vp.addEventListener('resize', this.handler)
    // Scroll fires for the shift-up on iOS, which resize alone does not report.
    vp.addEventListener('scroll', this.handler)
  }

  stop(): void {
    const vp = window.visualViewport
    this.onChange = null
    this.lastReading = null
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!vp) return
    vp.removeEventListener('resize', this.handler)
    vp.removeEventListener('scroll', this.handler)
  }
}
