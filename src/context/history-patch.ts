// Single owner of the history.pushState / replaceState patch.
//
// Two collectors (breadcrumbs and frustration) both need to know when an SPA
// navigates. When each wrapped history itself, teardown could only restore the
// native function if it happened to be the outermost wrapper — so tearing them
// down in install order (FIFO teardown of a LIFO stack) left one dead wrapper
// behind per cycle, and Turbo Drive reinstalls on every visit. Refcounting one
// wrapper here makes the install order irrelevant: the patch goes on when the
// first listener subscribes and comes off when the last one unsubscribes.

export interface HistoryNavigationEvent {
  type: 'push' | 'replace' | 'pop'
  fromUrl: string
  toUrl: string
}

type NavListener = (event: HistoryNavigationEvent) => void

const listeners = new Set<NavListener>()

let nativePushState: History['pushState'] | null = null
let nativeReplaceState: History['replaceState'] | null = null
let installedPushState: History['pushState'] | null = null
let installedReplaceState: History['replaceState'] | null = null
let popstateHandler: (() => void) | null = null
let lastUrl: string | null = null

// Subscribes to pushState, replaceState and popstate. Returns an unsubscribe
// function; calling it twice is harmless.
export function onHistoryNavigation(listener: NavListener): () => void {
  listeners.add(listener)
  install()

  let released = false
  return () => {
    if (released) return
    released = true
    listeners.delete(listener)
    if (listeners.size === 0) uninstall()
  }
}

function notify(type: HistoryNavigationEvent['type'], fromUrl: string): void {
  const event = { type, fromUrl, toUrl: location.href }
  lastUrl = event.toUrl
  // Copy first: a listener may unsubscribe (or subscribe) while being notified.
  for (const listener of [...listeners]) {
    try { listener(event) } catch { /* never propagate into the host page */ }
  }
}

function install(): void {
  if (installedPushState) return

  lastUrl = location.href
  popstateHandler = () => notify('pop', lastUrl ?? location.href)
  window.addEventListener('popstate', popstateHandler)

  // Snapshot the raw functions and invoke them with .call — binding would hand
  // back a different function object on uninstall, so the host page would never
  // get its own pushState identity back and each cycle would add a bind layer.
  nativePushState = history.pushState
  nativeReplaceState = history.replaceState
  const pushOrig = nativePushState
  const replaceOrig = nativeReplaceState

  installedPushState = function (data: unknown, unused: string, url?: string | URL | null) {
    const fromUrl = location.href
    pushOrig.call(history, data, unused, url)
    notify('push', fromUrl)
  }
  installedReplaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    const fromUrl = location.href
    replaceOrig.call(history, data, unused, url)
    notify('replace', fromUrl)
  }
  history.pushState = installedPushState
  history.replaceState = installedReplaceState
}

function uninstall(): void {
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler)
    popstateHandler = null
  }
  // Only restore if nothing (e.g. an SPA router) re-wrapped the functions
  // after us — restoring the stale snapshot would discard their wrapper.
  if (nativePushState && history.pushState === installedPushState) {
    history.pushState = nativePushState
  }
  if (nativeReplaceState && history.replaceState === installedReplaceState) {
    history.replaceState = nativeReplaceState
  }
  nativePushState = null
  nativeReplaceState = null
  installedPushState = null
  installedReplaceState = null
  lastUrl = null
}
