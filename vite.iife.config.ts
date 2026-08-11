import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  // Classic-script pages cannot resolve the bare import('@rrweb/record'), so
  // this bundle must skip straight to the CDN loader in record/session.ts.
  define: {
    __MTB_IIFE__: 'true',
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/global.ts'),
      name: 'MakeThisBetter',
      formats: ['iife'],
      fileName: () => 'makethisbetter.js',
    },
    rollupOptions: {
      external: ['@rrweb/record'],
      output: {
        exports: 'default',
        globals: {
          '@rrweb/record': 'rrwebRecord',
        },
        // Classic-script pages get exactly one file: the html-to-image dynamic
        // import (screenshot/capture.ts) must be folded back into the bundle,
        // not emitted as a chunk this build could never load.
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
    sourcemap: true,
    target: 'es2020',
  },
  root: '.',
  publicDir: 'demo/public',
})
