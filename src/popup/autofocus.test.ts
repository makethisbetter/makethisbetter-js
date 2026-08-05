import { afterEach, describe, it, expect, vi } from 'vitest'
import { CommentPopup } from './comment'
import { DrawNoteBar } from '../annotate/draw-note-bar'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'

function setPointerCoarse(coarse: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
  })) as unknown as typeof window.matchMedia
}

/**
 * Every panel focuses its field on open. That is fine on a desktop and
 * destructive on a phone: the panel is position:fixed, so the browser cannot
 * bring the field into view by moving the panel and scrolls the document
 * instead — and the annotation freeze (overflow:hidden) blocks the user from
 * scrolling back. Tapping to annotate left the page somewhere else entirely.
 *
 * preventScroll keeps the focus and drops the scrolling. The clarify card is
 * absent here on purpose: it only refocuses after the reporter sends a reply,
 * which is already their own action inside an open sheet.
 */
describe('autofocus never scrolls the host page', () => {
  function watchFocus() {
    return vi.spyOn(HTMLElement.prototype, 'focus')
  }

  afterEach(() => {
    vi.restoreAllMocks()
    setPointerCoarse(false)
    document.body.innerHTML = ''
  })

  // Focusing opens the keyboard, and iOS repositions position:fixed elements
  // as it animates — the panel shuffles with no style change of ours behind
  // it. The reporter tapping the field puts that movement where they asked
  // for it.
  it('does not focus the comment field on a touch device', () => {
    setPointerCoarse(true)
    const focus = watchFocus()
    const shadow = new ShadowContainer()
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: 100,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
    })

    expect(focus).not.toHaveBeenCalled()

    popup.destroy()
    shadow.destroy()
  })

  it('comment popup focuses without scrolling', () => {
    const focus = watchFocus()
    const shadow = new ShadowContainer()
    const popup = new CommentPopup(shadow, {
      targetName: 'Export PDF',
      x: 100,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClose: vi.fn(),
    })

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })

    popup.destroy()
    shadow.destroy()
  })

  it('draw note bar focuses without scrolling', () => {
    const focus = watchFocus()
    const shadow = new ShadowContainer()
    const bar = new DrawNoteBar(shadow, {
      messages: getMessages('en'),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
    })

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })

    bar.destroy()
    shadow.destroy()
  })
})
