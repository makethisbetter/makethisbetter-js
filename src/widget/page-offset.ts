/**
 * Reserves room at the top of the host page for the annotation toolbar, so the
 * bar occupies space of its own instead of sitting on the customer's content.
 *
 * Without this the bar is roughly 100px of dead zone on a phone — 44px plus
 * the notch inset — covering exactly the strip most sites put their header in,
 * and taps there do nothing at all with no explanation. Measured on a device:
 * everything below responded, the whole top band did not.
 *
 * Known limit, and it is not small: `position: fixed` and `sticky` elements do
 * not move with padding. A site whose header is fixed keeps it where it is,
 * still underneath the bar. This buys back normal-flow content, which is most
 * of the page, and nothing else.
 *
 * The host page is not ours, so the previous inline value is put back verbatim
 * — writing '' would delete a padding the page had set for its own reasons.
 */
export class PageOffset {
  private applied = false
  private previousPadding = ''
  private previousTransition = ''

  reserve(px: number): void {
    if (this.applied || px <= 0) return
    this.applied = true

    const style = document.body.style
    this.previousPadding = style.paddingTop
    this.previousTransition = style.transition

    const current = parseFloat(getComputedStyle(document.body).paddingTop) || 0
    // Suppress any transition the page has on padding: the bar appears at once,
    // and a site animating its own layout in response looks like a glitch.
    style.transition = 'none'
    style.paddingTop = `${current + px}px`
  }

  release(): void {
    if (!this.applied) return
    this.applied = false

    const style = document.body.style
    style.paddingTop = this.previousPadding
    style.transition = this.previousTransition
  }

  isApplied(): boolean {
    return this.applied
  }
}
