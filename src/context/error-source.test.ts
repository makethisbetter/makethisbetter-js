import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { errorSource, type ErrorSourceEvent } from './error-source'

describe('ErrorSource', () => {
  let unsubs: (() => void)[]

  beforeEach(() => {
    unsubs = []
  })

  afterEach(() => {
    unsubs.forEach((fn) => fn())
  })

  it('subscribe returns an unsubscribe function', () => {
    const unsub = errorSource.subscribe(() => {})
    unsubs.push(unsub)
    expect(typeof unsub).toBe('function')
  })

  it('delivers window.onerror events to a subscriber', () => {
    const received: ErrorSourceEvent[] = []
    const unsub = errorSource.subscribe((e) => received.push(e))
    unsubs.push(unsub)

    window.onerror?.('Test error', 'test.js', 10, 5, new Error('boom'))

    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('Test error')
    expect(received[0].source).toBe('test.js')
    expect(received[0].line).toBe(10)
    expect(received[0].col).toBe(5)
  })

  it('delivers events to multiple subscribers', () => {
    const a: ErrorSourceEvent[] = []
    const b: ErrorSourceEvent[] = []
    const unsubA = errorSource.subscribe((e) => a.push(e))
    const unsubB = errorSource.subscribe((e) => b.push(e))
    unsubs.push(unsubA, unsubB)

    window.onerror?.('multi', 'file.js', 1, 1, undefined)

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].message).toBe('multi')
    expect(b[0].message).toBe('multi')
  })

  it('unsubscribing stops delivery to that listener', () => {
    const received: ErrorSourceEvent[] = []
    const unsub = errorSource.subscribe((e) => received.push(e))

    window.onerror?.('before unsub', 'file.js', 1, 1, undefined)
    expect(received).toHaveLength(1)

    unsub()

    window.onerror?.('after unsub', 'file.js', 2, 1, undefined)
    expect(received).toHaveLength(1)
  })

  it('auto-unhooks window.onerror when last subscriber leaves', () => {
    const onErrorBefore = window.onerror

    const unsub1 = errorSource.subscribe(() => {})
    const unsub2 = errorSource.subscribe(() => {})

    expect(window.onerror).not.toBe(onErrorBefore)

    unsub1()
    expect(window.onerror).not.toBe(onErrorBefore)

    unsub2()
    expect(window.onerror).toBe(onErrorBefore)
  })

  it('leaves an onerror handler installed after hooking in place when unhooking', () => {
    const onErrorBefore = window.onerror
    const unsub = errorSource.subscribe(() => {})

    const pageHandler = vi.fn()
    window.onerror = pageHandler

    unsub()

    expect(window.onerror).toBe(pageHandler)
    window.onerror = onErrorBefore ?? null
  })

  it('captures unhandled promise rejections', () => {
    const received: ErrorSourceEvent[] = []
    const unsub = errorSource.subscribe((e) => received.push(e))
    unsubs.push(unsub)

    const event = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: new Error('rejected') })
    window.dispatchEvent(event)

    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('Unhandled rejection: rejected')
  })

  it('formats non-Error rejection reasons as strings', () => {
    const received: ErrorSourceEvent[] = []
    const unsub = errorSource.subscribe((e) => received.push(e))
    unsubs.push(unsub)

    const event = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: 'string reason' })
    window.dispatchEvent(event)

    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('Unhandled rejection: string reason')
  })

  it('chains to original window.onerror handler', () => {
    const originalCalled = vi.fn()
    window.onerror = originalCalled

    const unsub = errorSource.subscribe(() => {})
    unsubs.push(unsub)

    window.onerror?.('chained', 'file.js', 1, 1, undefined)

    expect(originalCalled).toHaveBeenCalledOnce()
  })
})
