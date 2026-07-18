import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RecordControlBar } from './control-bar'
import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'

function createMockShadow(): ShadowContainer & { appended: Node[] } {
  const appended: Node[] = []
  return {
    appended,
    el: <T extends HTMLElement>(tag: string, className?: string): T => {
      const el = document.createElement(tag) as T
      if (className) el.className = className
      return el
    },
    append: (...nodes: Node[]) => {
      nodes.forEach((n) => {
        appended.push(n)
        document.body.appendChild(n)
      })
    },
    remove: vi.fn(),
    root: document.createElement('div') as unknown as ShadowRoot,
    destroy: vi.fn(),
  } as unknown as ShadowContainer & { appended: Node[] }
}

function createMessages(): I18nMessages {
  return {
    record: {
      stop: 'Stop',
      timer_label: 'Recording',
      max_reached: 'Maximum recording time reached',
    },
  } as unknown as I18nMessages
}

describe('RecordControlBar', () => {
  let shadow: ReturnType<typeof createMockShadow>
  let bar: RecordControlBar

  beforeEach(() => {
    vi.useFakeTimers()
    shadow = createMockShadow()
  })

  afterEach(() => {
    bar?.destroy()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('constructor creates DOM with timer and stop button', () => {
    bar = new RecordControlBar(shadow, createMessages(), () => 0, () => {})

    expect(shadow.appended).toHaveLength(1)
    const container = shadow.appended[0] as HTMLElement

    expect(container.querySelector('.mtb-record-dot')).toBeTruthy()
    expect(container.querySelector('.mtb-record-timer')).toBeTruthy()
    expect(container.querySelector('.mtb-record-stop')).toBeTruthy()
    expect(container.querySelector('.mtb-record-stop')!.textContent).toBe('Stop')
  })

  it('stop button fires the onStop callback', () => {
    const onStop = vi.fn()
    bar = new RecordControlBar(shadow, createMessages(), () => 0, onStop)

    const stopBtn = (shadow.appended[0] as HTMLElement).querySelector('.mtb-record-stop')!
    stopBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('timer updates display every second', () => {
    let seconds = 0
    bar = new RecordControlBar(shadow, createMessages(), () => seconds, () => {})

    const timerEl = (shadow.appended[0] as HTMLElement).querySelector('.mtb-record-timer')!
    expect(timerEl.textContent).toBe('00:00')

    seconds = 5
    vi.advanceTimersByTime(1000)
    expect(timerEl.textContent).toBe('00:05')

    seconds = 65
    vi.advanceTimersByTime(1000)
    expect(timerEl.textContent).toBe('01:05')
  })

  it('destroy removes DOM element and stops interval', () => {
    let seconds = 0
    bar = new RecordControlBar(shadow, createMessages(), () => seconds, () => {})

    const container = shadow.appended[0] as HTMLElement
    expect(document.body.contains(container)).toBe(true)

    bar.destroy()
    expect(document.body.contains(container)).toBe(false)

    seconds = 99
    vi.advanceTimersByTime(5000)
  })

  it('initial timer text is 00:00', () => {
    bar = new RecordControlBar(shadow, createMessages(), () => 0, () => {})

    const timerEl = (shadow.appended[0] as HTMLElement).querySelector('.mtb-record-timer')!
    expect(timerEl.textContent).toBe('00:00')
  })
})
