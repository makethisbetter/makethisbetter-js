import rrwebReplayCss from 'rrweb/dist/style.css?inline'

type RRWebEvent = Record<string, unknown>

interface ReplayerInstance {
  play: () => void
  pause: () => void
  destroy?: () => void
  getMetaData?: () => { totalTime: number }
  wrapper?: HTMLElement
}

interface ReplayerCtor {
  new (events: RRWebEvent[], config: Record<string, unknown>): ReplayerInstance
}

interface RRWebReplayGlobals {
  rrweb?: { Replayer?: ReplayerCtor }
  rrwebReplay?: { Replayer?: ReplayerCtor }
}

// Pinned version + SRI: this executes on customers' pages, so a floating tag
// would be a supply-chain hole. Matches the recorder (@rrweb/record@2.1.0).
// Recompute after a bump: curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
const RRWEB_REPLAY_CDN = 'https://cdn.jsdelivr.net/npm/rrweb@2.1.0/umd/rrweb.min.js'
const RRWEB_REPLAY_SRI = 'sha384-eYepXWkUHsRKTdAMKySp6q2UHL1vQKrpVrMYpu1A+wmnAY5jo8lOG5U/1oMYATd1'

let replayerLoaded: Promise<ReplayerCtor> | null = null

function findGlobalReplayer(): ReplayerCtor | undefined {
  const win = globalThis as unknown as Window & RRWebReplayGlobals
  return win.rrweb?.Replayer ?? win.rrwebReplay?.Replayer
}

function loadReplayer(): Promise<ReplayerCtor> {
  if (replayerLoaded) return replayerLoaded
  replayerLoaded = new Promise<ReplayerCtor>((resolve, reject) => {
    const existing = findGlobalReplayer()
    if (existing) { resolve(existing); return }
    const script = document.createElement('script')
    script.src = RRWEB_REPLAY_CDN
    script.integrity = RRWEB_REPLAY_SRI
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      const ctor = findGlobalReplayer()
      if (ctor) resolve(ctor)
      else reject(new Error('rrweb Replayer global not found after script load'))
    }
    script.onerror = () => reject(new Error('Failed to load rrweb replayer from CDN'))
    document.head.appendChild(script)
  }).catch((err) => {
    replayerLoaded = null
    throw err
  })
  return replayerLoaded
}

function ensureReplayStyles(root: ParentNode & Node): void {
  const container = root as unknown as { querySelector: (s: string) => Element | null; appendChild: (n: Node) => void }
  if (container.querySelector('style[data-mtb-rrweb]')) return
  const style = document.createElement('style')
  style.setAttribute('data-mtb-rrweb', '')
  style.textContent = rrwebReplayCss
  container.appendChild(style)
}

export interface RecordingReplayHandle {
  destroy: () => void
}

// Plays rrweb events inside `mount`, scaling the recorded viewport to fit the
// mount width. Resolves once playback starts; rejects if the replayer can't
// load so callers can show a fallback.
export async function playRecording(
  mount: HTMLElement,
  styleRoot: ParentNode & Node,
  events: RRWebEvent[],
): Promise<RecordingReplayHandle> {
  const Replayer = await loadReplayer()
  ensureReplayStyles(styleRoot)

  mount.innerHTML = ''
  const replayer = new Replayer(events, {
    root: mount,
    speed: 1,
    showController: false,
    mouseTail: false,
    skipInactive: true,
  })
  replayer.play()
  scaleToFit(mount)

  return {
    destroy: () => {
      try {
        replayer.pause()
        replayer.destroy?.()
      } catch {
        // ignore teardown errors
      }
      mount.innerHTML = ''
    },
  }
}

function scaleToFit(mount: HTMLElement): void {
  const wrapper = mount.querySelector<HTMLElement>('.replayer-wrapper')
  const iframe = mount.querySelector<HTMLElement>('iframe')
  if (!wrapper || !iframe) return
  const recordedWidth = parseFloat(iframe.style.width) || iframe.offsetWidth
  if (!recordedWidth) return
  const scale = Math.min(1, mount.clientWidth / recordedWidth)
  wrapper.style.transform = `scale(${scale})`
  wrapper.style.transformOrigin = 'top left'
}
