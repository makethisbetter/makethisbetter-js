import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RecordSession } from './session'
import type { ShadowContainer } from '../widget/shadow'

const mockStopFn = vi.fn()
const mockRecord = Object.assign(
  vi.fn(() => mockStopFn),
  { addCustomEvent: vi.fn() },
)

// Force the bundler import path to fail so start() exercises the CDN fallback,
// mirroring the IIFE/CDN build where the bare specifier is unresolvable.
vi.mock('@rrweb/record', () => {
  throw new Error('rrweb not installed')
})

function createMockShadow(): ShadowContainer {
  return {
    el: <T extends HTMLElement>(tag: string, className?: string): T => {
      const el = document.createElement(tag) as T
      if (className) el.className = className
      return el
    },
    append: vi.fn(),
    remove: vi.fn(),
    root: document.createElement('div') as unknown as ShadowRoot,
    destroy: vi.fn(),
  } as unknown as ShadowContainer
}

// session.ts caches the rrweb loader promise at module level, so each test
// re-imports a fresh module instance.
async function freshSession(): Promise<RecordSession> {
  vi.resetModules()
  const { RecordSession: Cls } = await import('./session')
  return new Cls(createMockShadow())
}

describe('RecordSession CDN fallback', () => {
  let session: RecordSession | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as Record<string, unknown>).rrwebRecord
  })

  afterEach(() => {
    session?.destroy()
    session = null
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>).rrwebRecord
  })

  it('loads @rrweb/record UMD build via classic script tag', async () => {
    const appended: HTMLScriptElement[] = []
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      appended.push(script)
      // Simulate the UMD script executing: it sets the global, then load fires
      ;(globalThis as Record<string, unknown>).rrwebRecord = { record: mockRecord }
      script.onload?.(new Event('load'))
      return node
    })

    session = await freshSession()
    await session.start()

    expect(appended).toHaveLength(1)
    const script = appended[0]
    // rrweb 2.x publishes no UMD build in the `rrweb` package — its dist files
    // are ESM and throw "Unexpected token 'export'" in a classic script tag.
    // The record-only UMD lives in @rrweb/record's static /umd/ directory.
    expect(script.src).toContain('/npm/@rrweb/record@')
    expect(script.src).toContain('/umd/record.min.js')
    expect(script.integrity).toMatch(/^sha384-/)
    expect(script.crossOrigin).toBe('anonymous')
    expect(mockRecord).toHaveBeenCalledOnce()
  })

  it('rejects when the CDN script exposes no rrwebRecord global', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      ;(node as HTMLScriptElement).onload?.(new Event('load'))
      return node
    })

    session = await freshSession()
    await expect(session.start()).rejects.toThrow(/not found after script load/)
  })
})
