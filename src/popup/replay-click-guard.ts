/**
 * Swallows the compatibility click that a touch browser replays from the tap
 * which opened a panel.
 *
 * On iOS the sequence is pointerdown / pointerup — the widget places a pin and
 * opens the sheet — and only then does the browser dispatch a `click` for that
 * same finger press. By that point the sheet is on screen under the touch
 * point, so the click lands inside it. Observed on iOS 18.7 hitting the button
 * row: a few pixels either way and the gesture that opened the sheet would
 * have cancelled or submitted it. Cancelling pointerdown does not prevent it —
 * WebKit dispatches the click regardless.
 *
 * The replay is told apart by what preceded it, not by when it arrives. A real
 * press on the panel always fires `pointerdown` on the panel first; the replay
 * cannot, because its pointerdown went to the overlay underneath. An earlier
 * version simply ignored everything for 400ms, which also ate a fast, genuine
 * second tap — a window is a guess about human speed, and this is not.
 */
export function guardReplayClick(el: HTMLElement): () => void {
  let sawPointerDown = false

  const onPointerDown = (): void => {
    sawPointerDown = true
  }

  const onClick = (e: Event): void => {
    // detail 0 means the click did not come from a pointer at all — a button
    // activated by Enter or by assistive tech. Those never have a pointerdown
    // and must go through.
    const fromPointer = (e as MouseEvent).detail > 0
    if (fromPointer && !sawPointerDown) {
      e.stopPropagation()
      e.preventDefault()
    }
    sawPointerDown = false
  }

  el.addEventListener('pointerdown', onPointerDown, true)
  el.addEventListener('click', onClick, true)

  return () => {
    el.removeEventListener('pointerdown', onPointerDown, true)
    el.removeEventListener('click', onClick, true)
  }
}
