import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RecordSession } from './session'
import type { ShadowContainer } from '../widget/shadow'

const mockStopFn = vi.fn()
const mockAddCustomEvent = vi.fn()
const mockRecord = Object.assign(vi.fn(() => mockStopFn), { addCustomEvent: mockAddCustomEvent })

// Holds the rrweb import pending so a test can cancel inside the load window —
// the real thing is a dynamic import that takes 100-800ms cold.
let releaseImport: () => void
const pendingImport = new Promise<{ record: typeof mockRecord }>((resolve) => {
  releaseImport = () => resolve({ record: mockRecord })
})
vi.mock('@rrweb/record', () => pendingImport)

function createMockShadow(): ShadowContainer {
  return {
    el: <T extends HTMLElement>(tag: string): T => document.createElement(tag) as T,
    append: vi.fn(),
    remove: vi.fn(),
    root: document.createElement('div') as unknown as ShadowRoot,
    destroy: vi.fn(),
  } as unknown as ShadowContainer
}

describe('RecordSession cancelled during the rrweb load window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts nothing when destroy() lands before the loader resolves', async () => {
    vi.resetModules()
    const { RecordSession: Cls } = await import('./session')
    const onMaxReached = vi.fn()
    const session: RecordSession = new Cls(createMockShadow(), onMaxReached)

    const startPromise = session.start()
    // Reporter clicks Markup / the feedback tab / X while rrweb is still loading.
    session.destroy()
    releaseImport()
    await startPromise

    // No recorder: rrweb must not be serializing the host page's mutations.
    expect(mockRecord).not.toHaveBeenCalled()

    // No orphaned capture-phase click listener.
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(mockAddCustomEvent).not.toHaveBeenCalled()

    // No orphaned 60s timer that nobody holds a handle to.
    vi.advanceTimersByTime(120_000)
    expect(onMaxReached).not.toHaveBeenCalled()

    expect(session.getDuration()).toBe(0)
    expect(session.stop().events).toEqual([])
  })
})
