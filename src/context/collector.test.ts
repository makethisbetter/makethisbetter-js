import { describe, it, expect } from 'vitest'
import { collectPageContext } from './collector'

describe('collectPageContext', () => {
  it('returns required fields', () => {
    const ctx = collectPageContext()
    expect(typeof ctx.page_url).toBe('string')
    expect(typeof ctx.user_agent).toBe('string')
    expect(typeof ctx.browser).toBe('string')
    expect(typeof ctx.os).toBe('string')
    expect(typeof ctx.screen_width).toBe('number')
    expect(typeof ctx.screen_height).toBe('number')
  })
})
