import { afterEach, describe, it, expect, vi } from 'vitest'
import { guardReplayClick } from './replay-click-guard'

/**
 * The replay is told apart by what preceded it, not by when it arrives: a real
 * press on the panel fires pointerdown on the panel first, and the replayed
 * click cannot, because its pointerdown went to the overlay underneath.
 */
describe('guardReplayClick', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function panel() {
    const el = document.createElement('div')
    el.innerHTML = '<button>Send</button>'
    document.body.appendChild(el)
    const onClick = vi.fn()
    el.querySelector('button')!.addEventListener('click', onClick)
    return { el, button: el.querySelector('button')!, onClick }
  }

  const press = (el: Element) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  const click = (el: Element, detail = 1) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }))

  it('swallows a click with no press of its own', () => {
    const { el, button, onClick } = panel()
    guardReplayClick(el)

    click(button)

    expect(onClick).not.toHaveBeenCalled()
  })

  it('lets through a click that was actually pressed here', () => {
    const { el, button, onClick } = panel()
    guardReplayClick(el)

    press(button)
    click(button)

    expect(onClick).toHaveBeenCalledOnce()
  })

  // The previous version ignored everything for 400ms, which also ate a fast
  // second tap. Speed is no longer part of the judgement.
  it('lets through a genuine press however soon it follows', () => {
    const { el, button, onClick } = panel()
    guardReplayClick(el)

    click(button)          // the replay
    press(button)          // the reporter, immediately after
    click(button)

    expect(onClick).toHaveBeenCalledOnce()
  })

  // Enter on a focused button, or assistive tech, produces a click with no
  // pointer behind it and detail 0.
  it('lets through a click that did not come from a pointer at all', () => {
    const { el, button, onClick } = panel()
    guardReplayClick(el)

    click(button, 0)

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('stops guarding once released', () => {
    const { el, button, onClick } = panel()
    const release = guardReplayClick(el)

    release()
    click(button)

    expect(onClick).toHaveBeenCalledOnce()
  })
})
