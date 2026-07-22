import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
      },
    },
    minify: 'esbuild',
    sourcemap: true,
    target: 'es2020',
  },
  root: '.',
  publicDir: 'demo/public',
})
