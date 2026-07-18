import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RecordSession, type RecordingResult } from './session'
import type { ShadowContainer } from '../widget/shadow'

const mockStopFn = vi.fn()
const mockAddCustomEvent = vi.fn()
const mockRecord = Object.assign(
  vi.fn(({ emit }: { emit: (event: Record<string, unknown>) => void }) => {
    emit({ type: 2, data: 'snapshot' })
    return mockStopFn
  }),
  { addCustomEvent: mockAddCustomEvent },
)

vi.mock('@rrweb/record', () => ({ record: mockRecord }))

function createMockShadow(): ShadowContainer {
  const elements: HTMLElement[] = []
  return {
    el: <T extends HTMLElement>(tag: string, className?: string): T => {
      const el = document.createElement(tag) as T
      if (className) el.className = className
      return el
    },
    append: (...nodes: Node[]) => {
      nodes.forEach((n) => elements.push(n as HTMLElement))
    },
    remove: vi.fn(),
    root: document.createElement('div') as unknown as ShadowRoot,
    destroy: vi.fn(),
  } as unknown as ShadowContainer
}

describe('RecordSession', () => {
  let session: RecordSession
  let shadow: ShadowContainer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    shadow = createMockShadow()
  })

  afterEach(() => {
    session?.destroy()
    vi.useRealTimers()
  })

  it('start() initializes recording via rrweb', async () => {
    session = new RecordSession(shadow)
    await session.start()

    expect(mockRecord).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ emit: expect.any(Function) }),
    )
  })

  it('stop() returns captured events and duration', async () => {
    session = new RecordSession(shadow)
    await session.start()

    vi.advanceTimersByTime(5000)

    const result: RecordingResult = session.stop()

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual({ type: 2, data: 'snapshot' })
    expect(result.duration).toBe(5)
    expect(mockStopFn).toHaveBeenCalledOnce()
  })

  it('getDuration() returns elapsed time in seconds', async () => {
    session = new RecordSession(shadow)
    await session.start()

    expect(session.getDuration()).toBe(0)

    vi.advanceTimersByTime(3000)
    expect(session.getDuration()).toBe(3)

    vi.advanceTimersByTime(7000)
    expect(session.getDuration()).toBe(10)
  })

  it('getDuration() returns 0 before start', () => {
    session = new RecordSession(shadow)
    expect(session.getDuration()).toBe(0)
  })

  it('auto-fires onMaxReached at MAX_DURATION (60s)', async () => {
    const onMaxReached = vi.fn()
    session = new RecordSession(shadow, onMaxReached)
    await session.start()

    vi.advanceTimersByTime(59_999)
    expect(onMaxReached).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onMaxReached).toHaveBeenCalledOnce()
  })

  it('stop() clears the max-duration timer', async () => {
    const onMaxReached = vi.fn()
    session = new RecordSession(shadow, onMaxReached)
    await session.start()

    session.stop()
    vi.advanceTimersByTime(120_000)

    expect(onMaxReached).not.toHaveBeenCalled()
  })

  it('click events create ripple elements and add custom rrweb events', async () => {
    session = new RecordSession(shadow)
    await session.start()

    const clickEvent = new MouseEvent('click', {
      clientX: 100,
      clientY: 200,
      bubbles: true,
    })
    document.dispatchEvent(clickEvent)

    expect(mockAddCustomEvent).toHaveBeenCalledWith('mtb-click', {
      x: 100,
      y: 200,
      target: expect.any(String),
    })
  })

  it('stop() removes click handler', async () => {
    session = new RecordSession(shadow)
    await session.start()

    session.stop()
    vi.clearAllMocks()

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(mockAddCustomEvent).not.toHaveBeenCalled()
  })

  it('destroy() clears all state', async () => {
    session = new RecordSession(shadow)
    await session.start()

    session.destroy()

    expect(mockStopFn).toHaveBeenCalled()
    expect(session.getDuration()).toBe(0)
  })
})
