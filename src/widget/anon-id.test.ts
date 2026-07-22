import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAnonId } from './anon-id'

describe('getAnonId', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns an anon_-prefixed id', () => {
    expect(getAnonId()).toMatch(/^anon_[0-9a-f-]{36}$/)
  })

  it('persists the id in localStorage across calls', () => {
    const first = getAnonId()
    expect(getAnonId()).toBe(first)
    expect(window.localStorage.getItem('mtb_anon_id')).toBe(first)
  })

  it('returns a previously stored id', () => {
    window.localStorage.setItem('mtb_anon_id', 'anon_11111111-2222-3333-4444-555555555555')
    expect(getAnonId()).toBe('anon_11111111-2222-3333-4444-555555555555')
  })

  it('regenerates when the stored value is not anon_-prefixed', () => {
    window.localStorage.setItem('mtb_anon_id', 'usr_hijacked')
    expect(getAnonId()).toMatch(/^anon_/)
  })

  it('falls back to a stable in-memory id when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    const first = getAnonId()
    expect(first).toMatch(/^anon_/)
    expect(getAnonId()).toBe(first)
  })
})
