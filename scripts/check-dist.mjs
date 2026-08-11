#!/usr/bin/env node
// Refuses to pack or publish a tarball whose dist/ is missing or stale.
//
// dist/ is gitignored, so a clean clone of the public repo has none at all — and
// npm would happily publish a tarball whose main/module/unpkg/types all point at
// files that do not exist. A stale dist/ is worse: it publishes without error and
// ships code that predates the last source commits.
//
// Runs from prepack (i.e. on `npm pack` and `npm publish`) after the build.

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const failures = []

// Every path package.json advertises as an entry point must actually exist.
const entryPoints = new Set(
  [
    pkg.main,
    pkg.module,
    pkg.types,
    pkg.unpkg,
    pkg.jsdelivr,
    pkg.exports?.['.']?.import?.types,
    pkg.exports?.['.']?.import?.default,
    pkg.exports?.['.']?.require?.types,
    pkg.exports?.['.']?.require?.default,
    pkg.exports?.['./standalone'],
  ].filter(Boolean),
)

const distMtimes = []
for (const entry of entryPoints) {
  const absolute = join(packageDir, entry)
  let stats
  try {
    stats = statSync(absolute)
  } catch {
    failures.push(`missing entry point: ${entry} — run \`npm run build\``)
    continue
  }
  if (stats.size === 0) {
    failures.push(`empty entry point: ${entry}`)
    continue
  }
  distMtimes.push(stats.mtimeMs)
}

// Freshness: no shipped source file may be newer than the oldest built entry
// point. prepack rebuilds first, so tripping this means the build did not cover
// everything it should.
if (distMtimes.length > 0) {
  const oldestDist = Math.min(...distMtimes)
  for (const file of sourceFiles(join(packageDir, 'src'))) {
    if (statSync(file).mtimeMs > oldestDist) {
      failures.push(
        `stale dist: ${file.slice(packageDir.length + 1)} is newer than the built bundle — run \`npm run build\``,
      )
      break
    }
  }
}

// The ESM/CJS bundles lazy-load html-to-image from a sibling chunk. A dist
// that ships the entry without the chunk it imports would publish cleanly and
// then fail every screenshot capture (closed, to null) at runtime — so resolve
// every relative import()/require() in the built bundles and demand the target
// exists.
for (const entry of entryPoints) {
  if (!/\.(js|cjs|mjs)$/.test(entry)) continue
  const absolute = join(packageDir, entry)
  let source
  try {
    source = readFileSync(absolute, 'utf8')
  } catch {
    continue // already reported as a missing entry point above
  }
  for (const match of source.matchAll(/(?:import|require)\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g)) {
    try {
      statSync(join(dirname(absolute), match[1]))
    } catch {
      failures.push(`missing chunk: ${entry} imports ${match[1]} which does not exist — run \`npm run build\``)
    }
  }
}

// The entry point has top-level side effects — it registers
// window.MakeThisBetter and the turbo:load listener — so a blanket
// "sideEffects": false lets bundlers tree-shake a side-effect-only
// `import 'makethisbetter'` down to nothing. The bundles must stay declared.
const sideEffects = Array.isArray(pkg.sideEffects) ? pkg.sideEffects : []
for (const required of ['./dist/*.js', './dist/*.cjs']) {
  if (!sideEffects.includes(required)) {
    failures.push(`package.json sideEffects must list ${required} — the entry is side-effectful`)
  }
}

// Declaration files must not ship extensionless relative specifiers: the
// package is "type": "module", so node16/nodenext consumers parse them as ESM
// and an extensionless import errors (TS2834) or, with skipLibCheck, silently
// turns every exported type into `any`. fix-dts-specifiers.mjs rewrites them
// during the build; this guard keeps a build that skipped it out of the tarball.
for (const file of declarationFiles(join(packageDir, 'dist'))) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/(?:from\s+|import\()['"](\.\.?\/[^'"]+)['"]/g)) {
    if (!/\.[cm]?js$/.test(match[1])) {
      failures.push(
        `extensionless specifier '${match[1]}' in ${file.slice(packageDir.length + 1)} — run \`npm run build\``,
      )
    }
  }
}

if (failures.length > 0) {
  console.error('dist check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`dist check passed (${entryPoints.size} entry points)`)

function declarationFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...declarationFiles(full))
    else if (entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|css)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}
