import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { AnnotationToolbar } from './toolbar'
import { getMessages } from '../i18n'

function moveMouseTo(x: number, y: number) {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
}

describe('AnnotationToolbar', () => {
  let shadow: ShadowContainer
  let toolbar: AnnotationToolbar
  const messages = getMessages('en')

  function setup(opts?: { onModeChange?: (mode: 'markup' | 'record') => void }) {
    shadow = new ShadowContainer()
    toolbar = new AnnotationToolbar(shadow, messages, vi.fn(), opts?.onModeChange)
    vi.spyOn(toolbar['el'], 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 300,
      top: 10,
      bottom: 60,
      width: 200,
      height: 50,
      x: 100,
      y: 10,
      toJSON: () => {},
    } as DOMRect)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('creates a toolbar element in the shadow root', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-toolbar')).toBeInstanceOf(HTMLDivElement)
      toolbar.destroy()
    })

    it('renders markup and record buttons', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-toolbar-mode-markup')).toBeInstanceOf(HTMLButtonElement)
      expect(shadow.root.querySelector('.mtb-toolbar-mode-record')).toBeInstanceOf(HTMLButtonElement)
      toolbar.destroy()
    })

    it('renders the hint text', () => {
      setup()
      const hint = shadow.root.querySelector('.mtb-toolbar-hint')
      expect(hint!.textContent).toBe(messages.toolbar.hint)
      toolbar.destroy()
    })

    it('renders an exit button', () => {
      setup()
      expect(shadow.root.querySelector('.mtb-exit-btn')).toBeInstanceOf(HTMLButtonElement)
      toolbar.destroy()
    })

    it('starts in markup mode with markup button active', () => {
      setup()
      expect(toolbar.getMode()).toBe('markup')
      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      expect(markupBtn.classList.contains('active')).toBe(true)
      toolbar.destroy()
    })
  })

  describe('setMode', () => {
    it('switches to record mode and updates active class', () => {
      setup()
      toolbar.setMode('record')
      expect(toolbar.getMode()).toBe('record')

      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      const recordBtn = shadow.root.querySelector('.mtb-toolbar-mode-record')!
      expect(markupBtn.classList.contains('active')).toBe(false)
      expect(recordBtn.classList.contains('active')).toBe(true)

      const hint = shadow.root.querySelector('.mtb-toolbar-hint')!
      expect(hint.textContent).toBe(messages.toolbar.hintRecord)
      toolbar.destroy()
    })

    it('switches back to markup mode', () => {
      setup()
      toolbar.setMode('record')
      toolbar.setMode('markup')
      expect(toolbar.getMode()).toBe('markup')

      const hint = shadow.root.querySelector('.mtb-toolbar-hint')!
      expect(hint.textContent).toBe(messages.toolbar.hint)
      toolbar.destroy()
    })
  })

  describe('button clicks', () => {
    it('calls onModeChange when markup button is clicked', () => {
      const onModeChange = vi.fn()
      setup({ onModeChange })
      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      markupBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onModeChange).toHaveBeenCalledWith('markup')
      toolbar.destroy()
    })

    it('calls onModeChange when record button is clicked', () => {
      const onModeChange = vi.fn()
      setup({ onModeChange })
      const recordBtn = shadow.root.querySelector('.mtb-toolbar-mode-record')!
      recordBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onModeChange).toHaveBeenCalledWith('record')
      toolbar.destroy()
    })

    it('calls onExit when exit button is clicked', () => {
      shadow = new ShadowContainer()
      const onExit = vi.fn()
      toolbar = new AnnotationToolbar(shadow, messages, onExit)

      const exitBtn = shadow.root.querySelector('.mtb-exit-btn')!
      exitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onExit).toHaveBeenCalledOnce()
      toolbar.destroy()
    })

    it('works without onModeChange callback', () => {
      setup()
      const recordBtn = shadow.root.querySelector('.mtb-toolbar-mode-record')!
      expect(() => {
        recordBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }).not.toThrow()
      expect(toolbar.getMode()).toBe('record')
      toolbar.destroy()
    })
  })

  describe('destroy', () => {
    it('removes the toolbar element from the shadow root', () => {
      setup()
      toolbar.destroy()
      expect(shadow.root.querySelector('.mtb-toolbar')).toBeNull()
    })
  })

  describe('hover fade behavior', () => {
    it('fades out after hovering for 500ms', () => {
      setup()
      moveMouseTo(150, 30)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(false)
      vi.advanceTimersByTime(500)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(true)
      toolbar.destroy()
    })

    it('does not fade if mouse leaves before 500ms', () => {
      setup()
      moveMouseTo(150, 30)
      vi.advanceTimersByTime(300)
      moveMouseTo(1000, 1000)
      vi.advanceTimersByTime(500)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(false)
      toolbar.destroy()
    })

    it('restores to normal when mouse re-enters after fading', () => {
      setup()
      moveMouseTo(150, 30)
      vi.advanceTimersByTime(500)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(true)

      moveMouseTo(1000, 1000)
      moveMouseTo(150, 30)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(false)
      toolbar.destroy()
    })

    it('cancels pending fade when a toolbar button is clicked', () => {
      setup()
      moveMouseTo(150, 30)
      vi.advanceTimersByTime(300)
      const markupBtn = shadow.root.querySelector('.mtb-toolbar-mode-markup')!
      markupBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      vi.advanceTimersByTime(500)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(false)
      toolbar.destroy()
    })

    it('removes the mousemove listener on destroy', () => {
      setup()
      toolbar.destroy()
      moveMouseTo(150, 30)
      vi.advanceTimersByTime(500)
      expect(toolbar['el'].classList.contains('mtb-toolbar-faded')).toBe(false)
    })
  })
})
