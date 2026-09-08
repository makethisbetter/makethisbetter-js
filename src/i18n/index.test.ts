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
      '出错',
      '建议',
      '疑问',
    ])
  })

  it('falls back to English for unknown locale', () => {
    const m = getMessages('sv')
    expect(m.tab).toBe('Feedback')
  })

  it('returns English for "en-US" by prefix match fallback', () => {
    const m = getMessages('en-US')
    expect(m.tab).toBe('Feedback')
  })

  it('keeps the widget design quick-option set in every locale', () => {
    for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR']) {
      expect(getMessages(locale).popup.quickOptions).toHaveLength(3)
    }

    expect(getMessages('en').popup.quickOptions.map(option => option.label)).toEqual([
      'Broken',
      'Suggestion',
      'Confused',
    ])
  })

  it('returns Brazilian Portuguese for "pt-BR"', () => {
    const m = getMessages('pt-BR')
    expect(m.popup.placeholder).toBe('Descreva o problema ou sugestão...')
    expect(m.popup.submit).toBe('Enviar')
    expect(m.frustration.prompt).toBe('Algo não está funcionando? Conte para a gente.')
    expect(m.popup.quickOptions.map(option => option.label)).toEqual([
      'Erro',
      'Sugestão',
      'Dúvida',
    ])
  })

  it('returns Brazilian Portuguese for the "pt" alias', () => {
    expect(getMessages('pt')).toBe(getMessages('pt-BR'))
  })

  it('resolves "pt-PT" to the "pt" alias', () => {
    expect(getMessages('pt-PT')).toBe(getMessages('pt-BR'))
  })

  it('keeps every locale key-compatible with English', () => {
    const shape = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shape)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, shape(nested)]),
        )
      }
      return typeof value
    }

    for (const locale of ['zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR']) {
      expect(shape(getMessages(locale))).toEqual(shape(getMessages('en')))
    }
  })
})
