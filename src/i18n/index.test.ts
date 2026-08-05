import { describe, it, expect } from 'vitest'
import { getMessages } from './index'

describe('getMessages', () => {
  it('returns English for "en"', () => {
    const m = getMessages('en')
    expect(m.tab).toBe('Feedback')
  })

  it('returns Chinese for "zh-CN"', () => {
    const m = getMessages('zh-CN')
    expect(m.tab).toBe('反馈')
    expect(m.toolbar.hint).toBe('点击标注，拖动绘制')
    expect(m.toolbar.hintTouch).toBe('用手指圈出问题')
    expect(m.popup.quickOptions.map(option => option.label)).toEqual([
      '出问题了',
      '我有一个建议',
      '我有点疑问',
    ])
  })

  it('falls back to English for unknown locale', () => {
    const m = getMessages('pt')
    expect(m.tab).toBe('Feedback')
  })

  it('returns English for "en-US" by prefix match fallback', () => {
    const m = getMessages('en-US')
    expect(m.tab).toBe('Feedback')
  })

  it('keeps the widget design quick-option set in every locale', () => {
    for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de']) {
      expect(getMessages(locale).popup.quickOptions).toHaveLength(3)
    }

    expect(getMessages('en').popup.quickOptions.map(option => option.label)).toEqual([
      "Something's broken",
      'I have a suggestion',
      "I'm confused",
    ])
  })
})
