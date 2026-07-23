#!/usr/bin/env bash
# Widget SDK — verify all 7 documented install methods
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PASS=0
FAIL=0
TOTAL=7

report() {
  local label="$1" result="$2"
  # Extract last non-empty line (in case stderr was captured too)
  local last
  last="$(echo "$result" | grep -E '^(PASS|FAIL)$' | tail -1)"
  if [ "$last" = "PASS" ]; then
    printf "  %-40s \033[32mPASS\033[0m\n" "$label"
    PASS=$((PASS + 1))
  else
    printf "  %-40s \033[31mFAIL\033[0m\n" "$label"
    FAIL=$((FAIL + 1))
    # Print diagnostic info (non-PASS/FAIL lines)
    local diag
    diag="$(echo "$result" | grep -vE '^(PASS|FAIL)$' | head -3)"
    if [ -n "$diag" ]; then
      echo "    $diag" | head -3
    fi
  fi
}

cleanup_files=()
cleanup() {
  for f in "${cleanup_files[@]}"; do
    rm -f "$f"
  done
}
trap cleanup EXIT

echo ""
echo "=== Widget SDK Install Method Tests ==="
echo "    Node $(node --version)"
echo ""

# ---------------------------------------------------------------------------
# Test 1: CDN script tag (IIFE)
# The IIFE wraps as `var MakeThisBetter=function(){...}()` and also assigns
# window.MakeThisBetter inside the bundle. Verify the IIFE evaluates and
# exposes MakeThisBetter with an init function.
# ---------------------------------------------------------------------------
RESULT=$(node -e "
  const fs = require('fs');
  const code = fs.readFileSync('./dist/makethisbetter.js', 'utf8');
  const fn = new Function(code + '; return MakeThisBetter;');
  const MTB = fn();
  console.log(typeof MTB.init === 'function' ? 'PASS' : 'FAIL');
" 2>&1 || echo "FAIL")
report "Test 1: CDN script tag (IIFE)" "$RESULT"

# ---------------------------------------------------------------------------
# Test 2: npm ESM import
# ---------------------------------------------------------------------------
TMPESM="$DIR/.tmp-esm-test.$$.mjs"
cleanup_files+=("$TMPESM")
cat > "$TMPESM" <<'EOESM'
import { MakeThisBetter } from './dist/makethisbetter.esm.js';
console.log(typeof MakeThisBetter.init === 'function' ? 'PASS' : 'FAIL');
EOESM
RESULT=$(node "$TMPESM" 2>&1 || echo "FAIL")
report "Test 2: npm ESM import" "$RESULT"

# ---------------------------------------------------------------------------
# Test 3: npm CJS require
# The CJS build must use a real .cjs extension: with "type": "module" the
# nearest package.json makes Node parse .js files as ESM, silently discarding
# `exports.MakeThisBetter = ...`. Plain require() must work — no fallbacks.
# ---------------------------------------------------------------------------
TMPCJS="$DIR/.tmp-cjs-test.$$.cjs"
cleanup_files+=("$TMPCJS")
cat > "$TMPCJS" <<'EOCJS'
const m = require('./dist/makethisbetter.cjs');
console.log(typeof m.MakeThisBetter?.init === 'function' ? 'PASS' : 'FAIL');
EOCJS
RESULT=$(node "$TMPCJS" 2>&1 || echo "FAIL")
report "Test 3: npm CJS require" "$RESULT"

# ---------------------------------------------------------------------------
# Test 4: TypeScript types
# ---------------------------------------------------------------------------
TMPTS="$DIR/.tmp-ts-test.$$.ts"
cleanup_files+=("$TMPTS")
cat > "$TMPTS" <<'EOTS'
import { MakeThisBetter } from './dist/index';
const _init: (config: { projectKey: string }) => void = MakeThisBetter.init;
const _destroy: () => void = MakeThisBetter.destroy;
void _init;
void _destroy;
EOTS
TS_OUTPUT=$(npx tsc --noEmit --strict --moduleResolution bundler --module ESNext --target ES2020 --skipLibCheck "$TMPTS" 2>&1 || true)
TS_EXIT=${PIPESTATUS[0]:-$?}
# Check if tsc reported errors for our temp file
if echo "$TS_OUTPUT" | grep -q "error TS"; then
  RESULT="FAIL"
  echo "    tsc errors:"
  echo "$TS_OUTPUT" | grep "error TS" | head -5 | while read -r line; do echo "    $line"; done
else
  RESULT="PASS"
fi
report "Test 4: TypeScript types" "$RESULT"

# ---------------------------------------------------------------------------
# Test 5: unpkg URL resolution
# ---------------------------------------------------------------------------
RESULT=$(node -e "
  const pkg = require('./package.json');
  const fs = require('fs');
  if (!pkg.unpkg) { console.log('FAIL'); process.exit(); }
  console.log(fs.existsSync(pkg.unpkg) ? 'PASS' : 'FAIL');
" 2>&1 || echo "FAIL")
report "Test 5: unpkg URL resolution" "$RESULT"

# ---------------------------------------------------------------------------
# Test 6: jsdelivr URL resolution
# ---------------------------------------------------------------------------
RESULT=$(node -e "
  const pkg = require('./package.json');
  const fs = require('fs');
  if (!pkg.jsdelivr) { console.log('FAIL'); process.exit(); }
  console.log(fs.existsSync(pkg.jsdelivr) ? 'PASS' : 'FAIL');
" 2>&1 || echo "FAIL")
report "Test 6: jsdelivr URL resolution" "$RESULT"

# ---------------------------------------------------------------------------
# Test 7: Import map compatibility (dynamic ESM import)
# ---------------------------------------------------------------------------
RESULT=$(node -e "
  import('./dist/makethisbetter.esm.js').then(m => {
    console.log(typeof m.MakeThisBetter?.init === 'function' ? 'PASS' : 'FAIL');
  }).catch(() => console.log('FAIL'));
" 2>&1 || echo "FAIL")
report "Test 7: Import map compatibility" "$RESULT"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL/$TOTAL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
