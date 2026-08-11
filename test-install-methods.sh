#!/usr/bin/env bash
# Widget SDK — verify the documented install methods against the real artifact
#
# Everything here runs against a freshly packed tarball installed into a temp
# project, because that is what customers actually receive: testing dist/ files
# by relative path skips the exports map entirely, which is exactly how a broken
# "exports" shipped undetected before. Expects `npm run build` to have run.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PASS=0
FAIL=0
SKIP=0

report() {
  local label="$1" result="$2"
  # Extract last non-empty line (in case stderr was captured too)
  local last
  last="$(echo "$result" | grep -E '^(PASS|FAIL|SKIP)$' | tail -1)"
  if [ "$last" = "PASS" ]; then
    printf "  %-52s \033[32mPASS\033[0m\n" "$label"
    PASS=$((PASS + 1))
  elif [ "$last" = "SKIP" ]; then
    printf "  %-52s \033[33mSKIP\033[0m\n" "$label"
    SKIP=$((SKIP + 1))
  else
    printf "  %-52s \033[31mFAIL\033[0m\n" "$label"
    FAIL=$((FAIL + 1))
    # Print diagnostic info (non-PASS/FAIL lines)
    local diag
    diag="$(echo "$result" | grep -vE '^(PASS|FAIL|SKIP)$' | head -5)"
    if [ -n "$diag" ]; then
      echo "$diag" | sed 's/^/    /' | head -5
    fi
  fi
}

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
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
# Pack + install the tarball into a temp project. From here on, every test
# resolves 'makethisbetter' the way a customer's tooling would — through the
# exports map of the installed package, never through ./dist paths.
# prepack is skipped: the build already ran, and re-running it here would
# turn this into a build test instead of an artifact test.
# ---------------------------------------------------------------------------
TARBALL_RESULT=$(npm pack --ignore-scripts --pack-destination "$WORK" 2>/dev/null | tail -1)
if [ -z "$TARBALL_RESULT" ] || [ ! -f "$WORK/$TARBALL_RESULT" ]; then
  echo "  npm pack failed — cannot run install tests"
  exit 1
fi
CONSUMER="$WORK/consumer"
mkdir -p "$CONSUMER"
( cd "$CONSUMER" \
  && npm init -y >/dev/null 2>&1 \
  && npm install --no-audit --no-fund "$WORK/$TARBALL_RESULT" >/dev/null 2>&1 )
if [ ! -d "$CONSUMER/node_modules/makethisbetter" ]; then
  echo "  npm install of the packed tarball failed — cannot run install tests"
  exit 1
fi

# ---------------------------------------------------------------------------
# Test 2: npm CJS require('makethisbetter')
# Exercises exports["."].require.default of the installed package.
# ---------------------------------------------------------------------------
cat > "$CONSUMER/main.cjs" <<'EOCJS'
const m = require('makethisbetter');
console.log(typeof m.MakeThisBetter?.init === 'function' ? 'PASS' : 'FAIL');
EOCJS
RESULT=$(cd "$CONSUMER" && node main.cjs 2>&1 || echo "FAIL")
report "Test 2: npm CJS require('makethisbetter')" "$RESULT"

# ---------------------------------------------------------------------------
# Test 3: npm ESM import('makethisbetter')
# Exercises exports["."].import.default; also covers import-map installs,
# which resolve the same ESM entry.
# ---------------------------------------------------------------------------
cat > "$CONSUMER/main.mjs" <<'EOESM'
import { MakeThisBetter } from 'makethisbetter';
console.log(typeof MakeThisBetter.init === 'function' ? 'PASS' : 'FAIL');
EOESM
RESULT=$(cd "$CONSUMER" && node main.mjs 2>&1 || echo "FAIL")
report "Test 3: npm ESM import('makethisbetter')" "$RESULT"

# ---------------------------------------------------------------------------
# Tests 4 + 5: TypeScript types under BOTH resolution modes
# bundler is what Vite/webpack users see; node16/nodenext is what tsc-built
# Node apps see — and the mode where an extensionless specifier inside our
# d.ts files errors (TS2834) or silently turns the config types into `any`.
# skipLibCheck stays false so errors inside our shipped d.ts are not hidden;
# "types": [] keeps unrelated transitive @types out of the program so a
# third-party conflict cannot fail our check.
# Each mode also compiles a deliberately wrong config: if that produces no
# error, the types collapsed to `any` and the "valid" compile proves nothing.
# ---------------------------------------------------------------------------
TSC="$DIR/node_modules/.bin/tsc"

run_ts_mode() {
  local label="$1" module="$2" resolution="$3"
  cat > "$CONSUMER/tsconfig.json" <<EOJSON
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "$module",
    "moduleResolution": "$resolution",
    "skipLibCheck": false,
    "types": []
  },
  "files": ["valid.ts"]
}
EOJSON
  cat > "$CONSUMER/valid.ts" <<'EOTS'
import { MakeThisBetter } from 'makethisbetter';
import type { MakeThisBetterConfig } from 'makethisbetter';
const config: MakeThisBetterConfig = { projectKey: 'demo' };
MakeThisBetter.init(config);
MakeThisBetter.destroy();
EOTS
  cat > "$CONSUMER/invalid.ts" <<'EOTS'
import type { MakeThisBetterConfig } from 'makethisbetter';
const config: MakeThisBetterConfig = { projectKey: 42 };
void config;
EOTS
  local output
  output=$(cd "$CONSUMER" && "$TSC" -p tsconfig.json 2>&1)
  if echo "$output" | grep -q "error TS"; then
    report "$label" "$(printf '%s\nFAIL' "$(echo "$output" | grep 'error TS' | head -3)")"
    return
  fi
  ( cd "$CONSUMER" && node -e "
    const fs = require('fs');
    const c = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
    c.files = ['invalid.ts'];
    fs.writeFileSync('tsconfig.json', JSON.stringify(c));
  " )
  output=$(cd "$CONSUMER" && "$TSC" -p tsconfig.json 2>&1)
  if echo "$output" | grep -q "invalid.ts.*error TS"; then
    report "$label" "PASS"
  else
    report "$label" "$(printf 'wrong projectKey type compiled cleanly — config types are any\nFAIL')"
  fi
}

run_ts_mode "Test 4: TypeScript (moduleResolution bundler)" ESNext bundler
run_ts_mode "Test 5: TypeScript (moduleResolution nodenext)" NodeNext NodeNext

# ---------------------------------------------------------------------------
# Test 6: CDN availability (unpkg + jsdelivr)
# A real network check against the published package. Offline or blocked
# networks skip honestly instead of fake-passing on a local file check.
# ---------------------------------------------------------------------------
check_cdn() {
  local url="$1"
  local status
  status=$(curl -sIL -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)
  case "$status" in
    2??) echo "PASS" ;;
    000) echo "offline or unreachable ($url)"; echo "SKIP" ;;
    *) echo "HTTP $status for $url"; echo "FAIL" ;;
  esac
}
RESULT=$(check_cdn "https://unpkg.com/makethisbetter@1")
report "Test 6a: unpkg CDN availability" "$RESULT"
RESULT=$(check_cdn "https://cdn.jsdelivr.net/npm/makethisbetter@1")
report "Test 6b: jsdelivr CDN availability" "$RESULT"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped (of $TOTAL) ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
