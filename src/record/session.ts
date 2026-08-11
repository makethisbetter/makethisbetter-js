import type { ShadowContainer } from '../widget/shadow'
import { BLOCK_CLASS, MASK_TEXT_CLASS } from '../privacy/dom'
import { filterInputValue } from '../privacy/fields'
import { FILTERED_VALUE, filterSensitiveValue } from '../privacy/sanitize'
import {
  createSensitiveTextContext,
  hasSensitiveTextContext,
  type SensitiveTextContext,
} from '../privacy/text-context'

type RRWebEvent = Record<string, unknown>
type StopFn = () => void

interface RRWebRecordOptions {
  emit: (event: RRWebEvent) => void
  maskAllInputs: boolean
  maskInputOptions: Record<string, boolean>
  maskInputFn: (text: string, element: HTMLElement) => string
  maskTextFn: () => string
  blockClass: string
  maskTextClass: string
}

interface RRWebRecordFn {
  (options: RRWebRecordOptions): StopFn
  addCustomEvent: (tag: string, payload: Record<string, unknown>) => void
  mirror: { getNode: (id: number) => Node | null }
}

export interface RecordingResult {
  events: RRWebEvent[]
  duration: number
}

const MAX_DURATION_S = 60
const VALUE_ATTRIBUTE_NAMES = ['value', 'content'] as const
const MASKED_INPUT_TYPES = Object.fromEntries([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'email',
  'file',
  'hidden',
  'image',
  'month',
  'number',
  'password',
  'radio',
  'range',
  'reset',
  'search',
  'select',
  'submit',
  'tel',
  'text',
  'textarea',
  'time',
  'url',
  'week',
].map(type => [type, true]))
// The marker classes live with the rest of the privacy policy in privacy/dom;
// re-exported here because this module has been their documented import point
// since 1.x.
export { BLOCK_CLASS, MASK_TEXT_CLASS }
// Pinned version + SRI: this script executes on customers' pages, so a
// floating tag or unverified content would be a supply-chain hole. Bumping
// the version requires recomputing the hash from the exact CDN file:
//   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
// Must stay on @rrweb/record's static /umd/ build: the `rrweb` package ships
// no UMD in 2.x (its dist files are ESM and throw "Unexpected token 'export'"
// in a classic script tag), and jsDelivr's auto-minified files are unsafe for
// SRI because their hash changes when jsDelivr upgrades its minifier.
const RRWEB_CDN = 'https://cdn.jsdelivr.net/npm/@rrweb/record@2.1.0/umd/record.min.js'
const RRWEB_SRI = 'sha384-MrD66HBNSykaP2N95+6hQCFlF5oH2tvL3TD/zyvHNkP/sAFWZx98DX9MEDy8MdVT'

let rrwebLoaded: Promise<RRWebRecordFn> | null = null

// The IIFE/CDN bundle runs as a classic script, where the bare
// import('@rrweb/record') can never resolve — without this flag every CDN
// user's first recording would pay a thrown TypeError (console noise on the
// customer's page) plus a wasted round before the CDN fallback. The typeof
// guard keeps the untransformed source (vitest) on the ESM path.
function isIifeBuild(): boolean {
  return typeof __MTB_IIFE__ !== 'undefined' && __MTB_IIFE__
}

function loadRrweb(): Promise<RRWebRecordFn> {
  if (rrwebLoaded) return rrwebLoaded
  const load = isIifeBuild() ? loadViaCdn() : loadViaImport().catch(() => loadViaCdn())
  // A rejection must not stay cached: one flaky-network failure would otherwise
  // make every later Record tap fail instantly until the page reloads. Same
  // reset-on-failure as record/replay.ts.
  rrwebLoaded = load.catch((err) => {
    rrwebLoaded = null
    throw err
  })
  return rrwebLoaded
}

function filterReplayEvent(event: RRWebEvent, record: RRWebRecordFn): RRWebEvent {
  const filtered = filterSensitiveValue(event)
  filterReplayDomValues(filtered, record, createSensitiveTextContext())
  return filtered
}

function filterReplayDomValues(
  value: unknown,
  record: RRWebRecordFn,
  textContext: SensitiveTextContext,
): void {
  if (Array.isArray(value)) {
    value.forEach(item => filterReplayDomValues(item, record, textContext))
    return
  }
  if (!isRecord(value)) return

  const attributes = isRecord(value.attributes) ? value.attributes : null
  const hasAttributeValue = attributes && VALUE_ATTRIBUTE_NAMES.some(name => typeof attributes[name] === 'string')
  const hasNodeValue = typeof value.text === 'string'
    || typeof value.textContent === 'string'
    || typeof value.value === 'string'
    || hasAttributeValue
  const node = hasNodeValue && typeof value.id === 'number' ? record.mirror.getNode(value.id) : null
  if (node instanceof Element) {
    if (typeof value.text === 'string') value.text = filterInputValue(value.text, node)
    if (attributes) {
      for (const name of VALUE_ATTRIBUTE_NAMES) {
        const attributeValue = attributes[name]
        if (typeof attributeValue === 'string') attributes[name] = filterInputValue(attributeValue, node)
      }
    }
  } else if (node?.nodeType === Node.TEXT_NODE && hasSensitiveTextContext(node, textContext)) {
    if (typeof value.textContent === 'string') value.textContent = FILTERED_VALUE
    if (typeof value.value === 'string') value.value = FILTERED_VALUE
  }

  Object.values(value).forEach(item => filterReplayDomValues(item, record, textContext))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function loadViaImport(): Promise<RRWebRecordFn> {
  const mod = await import('@rrweb/record')
  return mod.record as unknown as RRWebRecordFn
}

interface RRWebGlobals {
  rrwebRecord?: { record: RRWebRecordFn }
  rrweb?: { record: RRWebRecordFn }
}

function findGlobalRecord(): RRWebRecordFn | undefined {
  const win = globalThis as unknown as Window & RRWebGlobals
  return win.rrwebRecord?.record ?? win.rrweb?.record
}

function loadViaCdn(): Promise<RRWebRecordFn> {
  return new Promise((resolve, reject) => {
    const existing = findGlobalRecord()
    if (existing) { resolve(existing); return }
    const script = document.createElement('script')
    script.src = RRWEB_CDN
    script.integrity = RRWEB_SRI
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      const record = findGlobalRecord()
      if (record) resolve(record)
      else reject(new Error('rrweb record global not found after script load'))
    }
    script.onerror = () => reject(new Error('Failed to load rrweb from CDN'))
    document.head.appendChild(script)
  })
}

export class RecordSession {
  private events: RRWebEvent[] = []
  private stopFn: StopFn | null = null
  private startedAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private clickHandler: ((e: MouseEvent) => void) | null = null
  private shadow: ShadowContainer
  private onMaxReached?: () => void
  private stopped = false
  private destroyed = false

  constructor(shadow: ShadowContainer, onMaxReached?: () => void) {
    this.shadow = shadow
    this.onMaxReached = onMaxReached
  }

  async start(): Promise<void> {
    const record = await loadRrweb()

    // A cold dynamic import takes hundreds of milliseconds, and the reporter can
    // cancel the replay inside that window. Without this guard the resumed start()
    // would attach a recorder, a document click listener and a 60s timer that no
    // live object holds a handle to — rrweb would then serialize every mutation of
    // the host page for the rest of the session, after an explicit cancel.
    if (this.destroyed) return

    this.startedAt = Date.now()
    this.stopped = false

    this.stopFn = record({
      emit: (event: RRWebEvent) => {
        if (this.stopped) return
        try {
          this.events.push(filterReplayEvent(event, record))
        } catch {
          // A malformed host event must not bypass filtering or stop recording.
        }
      },
      // Explicit options include hidden/file, which rrweb's maskAllInputs=true
      // preset omits. Every value is routed through the fixed policy, where
      // ordinary values are returned unchanged.
      maskAllInputs: false,
      maskInputOptions: MASKED_INPUT_TYPES,
      maskInputFn: (text, element) => (
        element.closest(`.${MASK_TEXT_CLASS}`) ? FILTERED_VALUE : filterInputValue(text, element)
      ),
      maskTextFn: () => FILTERED_VALUE,
      blockClass: BLOCK_CLASS,
      maskTextClass: MASK_TEXT_CLASS,
    })

    this.clickHandler = (e: MouseEvent) => {
      this.showClickRipple(e.clientX, e.clientY)
      record.addCustomEvent?.('mtb-click', {
        x: e.clientX,
        y: e.clientY,
        target: e.target instanceof HTMLElement ? e.target.tagName : '',
      })
    }
    document.addEventListener('click', this.clickHandler, true)

    this.timer = setTimeout(() => {
      this.onMaxReached?.()
    }, MAX_DURATION_S * 1000)
  }

  stop(): RecordingResult {
    this.stopped = true
    this.stopFn?.()
    this.stopFn = null
    this.cleanupTimer()
    this.cleanupClickHandler()

    return {
      events: this.events,
      duration: this.getDuration(),
    }
  }

  getDuration(): number {
    if (this.startedAt === 0) return 0
    return Math.max(1, Math.round((Date.now() - this.startedAt) / 1000))
  }

  destroy(): void {
    this.destroyed = true
    this.stopped = true
    this.stopFn?.()
    this.stopFn = null
    this.cleanupTimer()
    this.cleanupClickHandler()
    this.events = []
    this.startedAt = 0
  }

  private cleanupTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private cleanupClickHandler(): void {
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true)
      this.clickHandler = null
    }
  }

  private showClickRipple(x: number, y: number): void {
    const ripple = this.shadow.el<HTMLDivElement>('div', 'mtb-click-ripple')
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    this.shadow.append(ripple)
    ripple.addEventListener('animationend', () => ripple.remove())
  }
}
