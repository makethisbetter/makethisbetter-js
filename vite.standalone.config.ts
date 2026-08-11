import { defineConfig } from 'vite'
import { resolve } from 'path'

// A single-file ESM build for consumers who vendor one asset by path — Rails
// importmap downloads, self-hosting, copy-into-repo setups. The main ESM
// build splits html-to-image into a sibling chunk whose relative import
// cannot survive being served under a digested or relocated filename, so
// vendoring that file silently loses screenshot capture (it fails closed).
// Bundler and CDN consumers should keep using the split build; this one
// trades the lazy chunk for portability.
export default defineConfig({
  define: {
    __MTB_IIFE__: 'false',
  },
  build: {
    // Runs after the main build; wiping dist here would destroy its outputs.
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'makethisbetter.standalone.js',
    },
    rollupOptions: {
      external: ['@rrweb/record'],
      output: [
        { format: 'es', inlineDynamicImports: true },
      ],
    },
    minify: 'esbuild',
    sourcemap: true,
    target: 'es2020',
  },
  root: '.',
  publicDir: false,
})
