import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RecordSession } from './session'
import type { ShadowContainer } from '../widget/shadow'

const mockStopFn = vi.fn()
const mockRecord = Object.assign(
  vi.fn(() => mockStopFn),
  { addCustomEvent: vi.fn() },
)

// Force the bundler import path to fail so start() exercises the CDN fallback,
// mirroring the IIFE/CDN build where the bare specifier is unresolvable. The
// tracking spy lets the IIFE-flag tests prove the import was never attempted.
const importAttempted = vi.fn()
vi.mock('@rrweb/record', () => {
  importAttempted()
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
    vi.unstubAllGlobals()
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

  // A rejected loader promise must not stay cached: one flaky-network failure
  // would otherwise make every later Record tap fail instantly (silent markup
  // fallback) until the page reloads.
  it('retries the rrweb load after a failed attempt instead of caching the rejection', async () => {
    let failCdn = true
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      if (failCdn) {
        script.onerror?.(new Event('error'))
      } else {
        ;(globalThis as Record<string, unknown>).rrwebRecord = { record: mockRecord }
        script.onload?.(new Event('load'))
      }
      return node
    })

    session = await freshSession()
    await expect(session.start()).rejects.toThrow(/Failed to load rrweb/)

    failCdn = false
    await session.start()
    expect(mockRecord).toHaveBeenCalledOnce()
  })

  // The IIFE bundle defines __MTB_IIFE__=true so classic-script pages never
  // attempt the bare import('@rrweb/record') — it can never resolve there and
  // only produces a thrown TypeError on the customer's console.
  it('skips the bundler import and goes straight to the CDN when __MTB_IIFE__ is true', async () => {
    vi.stubGlobal('__MTB_IIFE__', true)
    const appended: HTMLScriptElement[] = []
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      appended.push(script)
      ;(globalThis as Record<string, unknown>).rrwebRecord = { record: mockRecord }
      script.onload?.(new Event('load'))
      return node
    })

    session = await freshSession()
    await session.start()

    expect(importAttempted).not.toHaveBeenCalled()
    expect(appended).toHaveLength(1)
    expect(mockRecord).toHaveBeenCalledOnce()
  })

  it('keeps the bundler-import-first path when __MTB_IIFE__ is false', async () => {
    vi.stubGlobal('__MTB_IIFE__', false)
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      ;(globalThis as Record<string, unknown>).rrwebRecord = { record: mockRecord }
      script.onload?.(new Event('load'))
      return node
    })

    session = await freshSession()
    await session.start()

    expect(importAttempted).toHaveBeenCalledOnce()
    expect(mockRecord).toHaveBeenCalledOnce()
  })
})
