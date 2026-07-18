import type { ShadowContainer } from '../widget/shadow'

type RRWebEvent = Record<string, unknown>
type StopFn = () => void

interface RRWebRecordFn {
  (options: { emit: (event: RRWebEvent) => void }): StopFn
  addCustomEvent: (tag: string, payload: Record<string, unknown>) => void
}

export interface RecordingResult {
  events: RRWebEvent[]
  duration: number
}

const MAX_DURATION_S = 60
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

function loadRrweb(): Promise<RRWebRecordFn> {
  if (rrwebLoaded) return rrwebLoaded
  rrwebLoaded = loadViaImport().catch(() => loadViaCdn())
  return rrwebLoaded
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

  constructor(shadow: ShadowContainer, onMaxReached?: () => void) {
    this.shadow = shadow
    this.onMaxReached = onMaxReached
  }

  async start(): Promise<void> {
    const record = await loadRrweb()

    this.startedAt = Date.now()
    this.stopped = false

    this.stopFn = record({
      emit: (event: RRWebEvent) => {
        if (!this.stopped) this.events.push(event)
      },
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
    return Math.round((Date.now() - this.startedAt) / 1000)
  }

  destroy(): void {
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
