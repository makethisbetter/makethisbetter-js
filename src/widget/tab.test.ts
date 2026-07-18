import { describe, expect, it, vi } from 'vitest'
import { FeedbackTab } from './tab'
import { ShadowContainer } from './shadow'
import { getMessages } from '../i18n'

function setupTab(position: 'left' | 'right' = 'right') {
  const shadow = new ShadowContainer()
  const onClick = vi.fn()
  const messages = getMessages('en')
  const tab = new FeedbackTab(shadow, messages, position, onClick)

  return { shadow, tab, onClick, messages }
}

describe('FeedbackTab', () => {
  it('renders button with feedback text', () => {
    const { shadow, tab, messages } = setupTab()

    const btn = shadow.root.querySelector<HTMLButtonElement>('.mtb-tab')
    expect(btn).toBeTruthy()
    expect(btn!.textContent).toBe(messages.tab)
    expect(btn!.getAttribute('aria-label')).toBe(messages.tab)

    tab.destroy()
    shadow.destroy()
  })

  it('positions on right by default (no left class)', () => {
    const { shadow, tab } = setupTab('right')

    const btn = shadow.root.querySelector<HTMLButtonElement>('.mtb-tab')!
    expect(btn.classList.contains('left')).toBe(false)

    tab.destroy()
    shadow.destroy()
  })

  it('adds left class when position is left', () => {
    const { shadow, tab } = setupTab('left')

    const btn = shadow.root.querySelector<HTMLButtonElement>('.mtb-tab')!
    expect(btn.classList.contains('left')).toBe(true)

    tab.destroy()
    shadow.destroy()
  })

  it('calls onClick when button is clicked', () => {
    const { shadow, tab, onClick } = setupTab()

    shadow.root.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    expect(onClick).toHaveBeenCalledOnce()

    tab.destroy()
    shadow.destroy()
  })

  it('setActive toggles active class', () => {
    const { shadow, tab } = setupTab()
    const btn = shadow.root.querySelector<HTMLButtonElement>('.mtb-tab')!

    tab.setActive(true)
    expect(btn.classList.contains('active')).toBe(true)

    tab.setActive(false)
    expect(btn.classList.contains('active')).toBe(false)

    tab.destroy()
    shadow.destroy()
  })

  it('destroy removes element from shadow root', () => {
    const { shadow, tab } = setupTab()

    expect(shadow.root.querySelector('.mtb-tab')).toBeTruthy()
    tab.destroy()
    expect(shadow.root.querySelector('.mtb-tab')).toBeNull()

    shadow.destroy()
  })

  it('destroy removes click listener', () => {
    const { shadow, tab, onClick } = setupTab()

    tab.destroy()
    const btn = shadow.root.querySelector('.mtb-tab')
    expect(btn).toBeNull()
    expect(onClick).not.toHaveBeenCalled()

    shadow.destroy()
  })
})
