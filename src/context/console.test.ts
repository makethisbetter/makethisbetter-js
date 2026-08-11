import { describe, it, expect, afterEach } from 'vitest'
import { ConsoleErrorCollector } from './console'

describe('ConsoleErrorCollector', () => {
  let collector: ConsoleErrorCollector

  afterEach(() => {
    collector?.stop()
  })

  it('starts empty', () => {
    collector = new ConsoleErrorCollector()
    collector.start()
    expect(collector.getErrors()).toHaveLength(0)
  })

  it('captures window.onerror events', () => {
    collector = new ConsoleErrorCollector()
    collector.start()

    window.onerror?.(
      'TypeError: card 4242 4242 4242 4242',
      'https://cdn.example.com/assets/export.js?token=secret#source',
      42,
      1,
      new TypeError('card 4242 4242 4242 4242'),
    )

    expect(collector.getErrors()).toEqual(['TypeError (/assets/export.js:42:1)'])
  })

  it('does not trust a page-defined error name as an error type', () => {
    collector = new ConsoleErrorCollector()
    collector.start()
    const error = new Error('boom')
    error.name = 'alice@example.com'

    window.onerror?.('boom', 'https://app.example.com/app.js', 1, 2, error)

    expect(collector.getErrors()).toEqual(['Error (/app.js:1:2)'])
  })

  it('deduplicates identical errors', () => {
    collector = new ConsoleErrorCollector()
    collector.start()

    window.onerror?.('Same error', 'file.js', 1, 1, undefined)
    window.onerror?.('Same error', 'file.js', 1, 1, undefined)

    expect(collector.getErrors()).toHaveLength(1)
  })

  it('getErrors returns a copy', () => {
    collector = new ConsoleErrorCollector()
    collector.start()
    const a = collector.getErrors()
    const b = collector.getErrors()
    expect(a).not.toBe(b)
  })
})
