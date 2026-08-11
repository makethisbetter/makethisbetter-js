import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onHistoryNavigation } from './history-patch'

describe('onHistoryNavigation', () => {
  let nativePushState: History['pushState']
  let nativeReplaceState: History['replaceState']

  beforeEach(() => {
    nativePushState = history.pushState
    nativeReplaceState = history.replaceState
  })

  afterEach(() => {
    history.pushState = nativePushState
    history.replaceState = nativeReplaceState
  })

  it('notifies on pushState, replaceState and popstate', () => {
    const listener = vi.fn()
    const unsubscribe = onHistoryNavigation(listener)

    history.pushState({}, '', '/a')
    history.replaceState({}, '', '/b')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it('describes the history operation and URL change', () => {
    const listener = vi.fn()
    const unsubscribe = onHistoryNavigation(listener)
    const fromUrl = location.href

    history.pushState({}, '', '/described-navigation')

    expect(listener).toHaveBeenCalledWith({
      type: 'push',
      fromUrl,
      toUrl: location.href,
    })
    unsubscribe()
  })

  it('still performs the real navigation', () => {
    const unsubscribe = onHistoryNavigation(vi.fn())

    history.pushState({}, '', '/real-navigation')
    expect(location.pathname).toBe('/real-navigation')

    unsubscribe()
  })

  // The regression this module exists for: two subscribers installed in order and
  // released in the SAME order (FIFO release of a LIFO wrapper stack) used to
  // leave a dead wrapper behind, one deeper per Turbo Drive visit.
  it('restores the native functions regardless of release order', () => {
    const releaseFirst = onHistoryNavigation(vi.fn())
    const releaseSecond = onHistoryNavigation(vi.fn())

    releaseFirst()
    releaseSecond()

    expect(history.pushState).toBe(nativePushState)
    expect(history.replaceState).toBe(nativeReplaceState)
  })

  it('keeps the patch installed while any subscriber remains', () => {
    const releaseFirst = onHistoryNavigation(vi.fn())
    const second = vi.fn()
    const releaseSecond = onHistoryNavigation(second)

    releaseFirst()
    history.pushState({}, '', '/c')
    expect(second).toHaveBeenCalledOnce()

    releaseSecond()
  })

  it('does not grow the wrapper depth across repeated subscribe/release cycles', () => {
    for (let i = 0; i < 100; i++) {
      const releaseFirst = onHistoryNavigation(vi.fn())
      const releaseSecond = onHistoryNavigation(vi.fn())
      releaseFirst()
      releaseSecond()
    }

    expect(history.pushState).toBe(nativePushState)
    expect(history.replaceState).toBe(nativeReplaceState)
  })

  it('is idempotent when an unsubscribe runs twice', () => {
    const release = onHistoryNavigation(vi.fn())
    const other = vi.fn()
    const releaseOther = onHistoryNavigation(other)

    release()
    release()

    history.pushState({}, '', '/d')
    expect(other).toHaveBeenCalledOnce()

    releaseOther()
    expect(history.pushState).toBe(nativePushState)
  })

  // Matches the pre-existing per-collector behaviour: an SPA router that wraps
  // history after us keeps its wrapper rather than being clobbered.
  it('leaves a wrapper installed after us in place', () => {
    const release = onHistoryNavigation(vi.fn())
    const routerPush: History['pushState'] = () => {}
    history.pushState = routerPush

    release()

    expect(history.pushState).toBe(routerPush)
  })

  it('keeps notifying the remaining listeners when one throws', () => {
    const releaseBad = onHistoryNavigation(() => { throw new Error('listener blew up') })
    const good = vi.fn()
    const releaseGood = onHistoryNavigation(good)

    expect(() => history.pushState({}, '', '/e')).not.toThrow()
    expect(good).toHaveBeenCalledOnce()

    releaseBad()
    releaseGood()
  })
})
