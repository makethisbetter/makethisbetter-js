// Frustration state that must outlive a single page visit.
//
// The detector and the widget controller are both rebuilt from scratch on every
// Turbo Drive navigation (see src/index.ts), which used to reset all of this.
// The consequences were: `rapid_navigation` could never fire (it needs 3
// timestamps within 5s but each visit contributed at most one), the 60s cooldown
// was bypassed by navigating, an already-reported error page re-prompted on
// revisit, and a reporter's explicit "Dismiss" did not survive one visit.
//
// sessionStorage is the right scope — this is per-tab, per-visit-series state,
// not a long-lived identity like mtb_anon_id. Writes are best-effort: Safari
// private mode and storage-partitioned iframes throw, so an in-memory copy backs
// every read (it covers the current page at least).

const STORAGE_KEY = 'mtb_frustration_state'
// Keeps a long browsing session from growing the stored payload without bound.
const MAX_ERROR_PAGE_URLS = 20

export interface FrustrationState {
  navTimestamps: number[]
  cooldownUntil: number
  errorPageUrls: string[]
  dismissedByUser: boolean
}

let memoryState: FrustrationState | null = null

// Every return path goes through normalize(), which rebuilds the arrays. Callers
// own their copy and mutate it in place (the detector pushes onto navTimestamps),
// so handing out a shared array would let one caller corrupt the stored state.
export function loadFrustrationState(): FrustrationState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return normalize(memoryState)
    return normalize(JSON.parse(raw))
  } catch {
    return normalize(memoryState)
  }
}

export function saveFrustrationState(state: FrustrationState): void {
  const normalized = normalize(state)
  memoryState = normalized
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // sessionStorage unavailable — the in-memory copy covers this page
  }
}

export function isFrustrationDismissed(): boolean {
  return loadFrustrationState().dismissedByUser
}

// Records a real refusal (the reporter clicked Dismiss), which suppresses
// proactive prompts for the rest of the tab session. An auto-hide must never
// call this — the 60s cooldown is what rate-limits an ignored prompt.
export function markFrustrationDismissed(): void {
  saveFrustrationState({ ...loadFrustrationState(), dismissedByUser: true })
}

export function clearFrustrationState(): void {
  memoryState = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // nothing to clear
  }
}

function normalize(value: unknown): FrustrationState {
  const raw = (value ?? {}) as Partial<Record<keyof FrustrationState, unknown>>
  return {
    navTimestamps: Array.isArray(raw.navTimestamps)
      ? raw.navTimestamps.filter((t): t is number => typeof t === 'number')
      : [],
    cooldownUntil: typeof raw.cooldownUntil === 'number' ? raw.cooldownUntil : 0,
    errorPageUrls: Array.isArray(raw.errorPageUrls)
      ? raw.errorPageUrls.filter((u): u is string => typeof u === 'string').slice(-MAX_ERROR_PAGE_URLS)
      : [],
    dismissedByUser: raw.dismissedByUser === true,
  }
}
