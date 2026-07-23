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

    window.onerror?.('TypeError: test error', 'export.js', 42, 1, new Error('test error'))

    expect(collector.getErrors()).toHaveLength(1)
    expect(collector.getErrors()[0]).toContain('TypeError: test error')
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
