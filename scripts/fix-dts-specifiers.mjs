#!/usr/bin/env node
// Rewrites extensionless relative specifiers in the emitted dist/**/*.d.ts.
//
// The package is "type": "module", so consumers on moduleResolution
// node16/nodenext parse our declaration files as ESM — where a relative import
// without an explicit extension is a hard error (TS2834), or with skipLibCheck
// silently degrades every config type to `any`. tsc preserves source
// specifiers verbatim in declaration emit, so the fix has to happen here,
// after `tsc --emitDeclarationOnly`.
//
// './types' becomes './types.js' (TS maps the .js specifier back to the
// sibling .d.ts), and directory imports like '../i18n' become '../i18n/index.js'.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const SPECIFIER = /(from\s+|import\()(['"])(\.\.?\/[^'"]+)\2/g

function declarationFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...declarationFiles(full))
    else if (entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function rewritten(file, specifier) {
  if (/\.[cm]?js$/.test(specifier)) return specifier
  const base = dirname(file)
  if (existsSync(join(base, `${specifier}.d.ts`))) return `${specifier}.js`
  if (existsSync(join(base, specifier, 'index.d.ts'))) return `${specifier}/index.js`
  throw new Error(`cannot resolve '${specifier}' from ${file}`)
}

let count = 0
for (const file of declarationFiles(distDir)) {
  const source = readFileSync(file, 'utf8')
  const output = source.replace(SPECIFIER, (_match, keyword, quote, specifier) => {
    const next = rewritten(file, specifier)
    if (next !== specifier) count += 1
    return `${keyword}${quote}${next}${quote}`
  })
  if (output !== source) writeFileSync(file, output)
}

console.log(`d.ts specifiers rewritten (${count})`)
