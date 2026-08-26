/// <reference types="vite/client" />

declare module '*.css?inline' {
  const css: string
  export default css
}

// Build-time flag injected by vite define: true in the IIFE/CDN bundle
// (vite.iife.config.ts), false in the ESM/CJS bundle (vite.config.ts).
// Left undefined under vitest so the source runs the ESM path unless a test
// stubs it via vi.stubGlobal.
declare const __MTB_IIFE__: boolean
