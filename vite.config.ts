import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  // Bundler consumers can resolve @rrweb/record locally, so keep the import
  // path first and the CDN loader as fallback (see record/session.ts).
  define: {
    __MTB_IIFE__: 'false',
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => {
        if (format === 'es') return 'makethisbetter.esm.js'
        // Real .cjs extension: "type": "module" makes Node parse .js as ESM,
        // which silently voids `exports.MakeThisBetter = ...`
        return 'makethisbetter.cjs'
      },
    },
    rollupOptions: {
      external: ['@rrweb/record'],
      // html-to-image is dynamically imported (screenshot/capture.ts) so the
      // majority of sessions that never capture skip its weight. Splitting it
      // into a sibling chunk keeps that laziness for consumers who load the
      // ESM file directly from a CDN; bundlers re-split it themselves. The
      // chunk name is pinned (no hash) so self-hosters copy a predictable
      // pair, and the cjs chunk needs a real .cjs extension — "type": "module"
      // would make Node parse a required .js chunk as ESM. NOTE: anyone
      // vendoring the ESM file as a single standalone asset (e.g. Rails
      // importmap download) must ship the chunk beside it, or screenshot
      // capture fails closed to null.
      output: [
        { format: 'es', chunkFileNames: 'html-to-image.js' },
        { format: 'cjs', chunkFileNames: 'html-to-image.cjs' },
      ],
    },
    minify: 'esbuild',
    sourcemap: true,
    target: 'es2020',
  },
  root: '.',
  publicDir: 'demo/public',
})
