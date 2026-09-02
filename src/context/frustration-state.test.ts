import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearFrustrationState,
  isFrustrationDismissed,
  loadFrustrationState,
  markFrustrationDismissed,
  saveFrustrationState,
} from './frustration-state'

describe('frustration state', () => {
  beforeEach(() => {
    clearFrustrationState()
  })

  afterEach(() => {
    clearFrustrationState()
    vi.restoreAllMocks()
  })

  it('starts empty', () => {
    expect(loadFrustrationState()).toEqual({
      navTimestamps: [],
      cooldownUntil: 0,
      errorPageUrls: [],
      dismissedByUser: false,
    })
  })

  it('round-trips through sessionStorage', () => {
    saveFrustrationState({
      navTimestamps: [1, 2, 3],
      cooldownUntil: 999,
      errorPageUrls: ['https://example.com/404'],
      dismissedByUser: true,
    })

    expect(loadFrustrationState()).toEqual({
      navTimestamps: [1, 2, 3],
      cooldownUntil: 999,
      errorPageUrls: ['https://example.com/404'],
      dismissedByUser: true,
    })
  })

  // The detector mutates its copy in place (navTimestamps.push), so a shared
  // array reference would corrupt the stored state from the outside.
  it('hands out copies rather than shared arrays', () => {
    saveFrustrationState({
      navTimestamps: [1],
      cooldownUntil: 0,
      errorPageUrls: ['a'],
      dismissedByUser: false,
    })

    const first = loadFrustrationState()
    first.navTimestamps.push(2)
    first.errorPageUrls.push('b')

    expect(loadFrustrationState().navTimestamps).toEqual([1])
    expect(loadFrustrationState().errorPageUrls).toEqual(['a'])
  })

  it('does not leak mutations into the empty default', () => {
    const first = loadFrustrationState()
    first.navTimestamps.push(42)

    expect(loadFrustrationState().navTimestamps).toEqual([])
  })

  it('markFrustrationDismissed persists a refusal without touching other fields', () => {
    saveFrustrationState({
      navTimestamps: [7],
      cooldownUntil: 5,
      errorPageUrls: [],
      dismissedByUser: false,
    })

    markFrustrationDismissed()

    expect(isFrustrationDismissed()).toBe(true)
    expect(loadFrustrationState().navTimestamps).toEqual([7])
    expect(loadFrustrationState().cooldownUntil).toBe(5)
  })

  it('caps the stored error page list', () => {
    saveFrustrationState({
      navTimestamps: [],
      cooldownUntil: 0,
      errorPageUrls: Array.from({ length: 40 }, (_, i) => `https://example.com/${i}`),
      dismissedByUser: false,
    })

    const stored = loadFrustrationState().errorPageUrls
    expect(stored).toHaveLength(20)
    expect(stored[stored.length - 1]).toBe('https://example.com/39')
  })

  it('ignores corrupted stored data', () => {
    window.sessionStorage.setItem('mtb_frustration_state', '{not json')

    expect(loadFrustrationState().navTimestamps).toEqual([])
    expect(isFrustrationDismissed()).toBe(false)
  })

  it('drops entries of the wrong type', () => {
    window.sessionStorage.setItem(
      'mtb_frustration_state',
      JSON.stringify({ navTimestamps: [1, 'x', 3], cooldownUntil: 'soon', errorPageUrls: [4, 'ok'], dismissedByUser: 'yes' }),
    )

    expect(loadFrustrationState()).toEqual({
      navTimestamps: [1, 3],
      cooldownUntil: 0,
      errorPageUrls: ['ok'],
      dismissedByUser: false,
    })
  })

  // Safari private mode and partitioned iframes throw on storage access.
  it('falls back to memory when sessionStorage throws', () => {
    const store = new Map<string, string>()
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => { throw new Error('denied') })

    saveFrustrationState({
      navTimestamps: [11],
      cooldownUntil: 0,
      errorPageUrls: [],
      dismissedByUser: true,
    })

    expect(loadFrustrationState().navTimestamps).toEqual([11])
    expect(isFrustrationDismissed()).toBe(true)
    expect(store.size).toBe(0)
  })
})
