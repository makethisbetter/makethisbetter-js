import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => {
        if (format === 'es') return 'makethisbetter.esm.js'
        // Real .cjs extension: "type": "module" makes Node parse .js as ESM,
        // which silently voids `exports.MakeThisBetter = ...` (AGE-423)
        return 'makethisbetter.cjs'
      },
    },
    rollupOptions: {
      external: ['@rrweb/record'],
      output: {
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
