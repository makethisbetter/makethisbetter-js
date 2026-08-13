import { afterEach, describe, it, expect, vi } from 'vitest'
import { ChatPopup } from './chat-popup'
import { DrawNoteBar } from '../annotate/draw-note-bar'
import { ShadowContainer } from '../widget/shadow'
import { getMessages } from '../i18n'

/**
 * Every panel focuses its field on open. That is fine on a desktop and
 * destructive on a phone: the panel is position:fixed, so the browser cannot
 * bring the field into view by moving the panel and scrolls the document
 * instead — and the annotation freeze (overflow:hidden) blocks the user from
 * scrolling back. Tapping to annotate left the page somewhere else entirely.
 *
 * preventScroll keeps the focus and drops the scrolling.
 */
describe('autofocus never scrolls the host page', () => {
  function watchFocus() {
    return vi.spyOn(HTMLElement.prototype, 'focus')
  }

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('chat card focuses its composer without scrolling', () => {
    const focus = watchFocus()
    const shadow = new ShadowContainer()
    const popup = new ChatPopup(shadow, {
      targetName: 'Export PDF',
      x: 100,
      y: 120,
      messages: getMessages('en'),
      onSubmit: vi.fn(),
      onClarify: vi.fn(),
      onAnswer: vi.fn(),
      onFinalize: vi.fn(),
      onCancel: vi.fn(),
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
