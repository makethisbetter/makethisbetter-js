import { WidgetController } from './widget/controller'
import { WIDGET_HOST_ID } from './context/dom-utils'
import type { MakeThisBetterConfig } from './types'

let instance: WidgetController | null = null
let lastConfig: MakeThisBetterConfig | null = null
// A mount deferred until DOMContentLoaded. Held so a second init() — or a
// destroy() — can call it off: otherwise each init before the document is ready
// queues its own listener, and every controller but the last mounts with no
// live reference, leaking its document listeners and detectors for good.
let pendingMount: (() => void) | null = null

function cancelPendingMount(): void {
  if (!pendingMount) return
  document.removeEventListener('DOMContentLoaded', pendingMount)
  pendingMount = null
}

function replaceInstance(config?: MakeThisBetterConfig): void {
  cancelPendingMount()
  instance?.destroy()
  instance = config ? new WidgetController(config) : null
}

const MakeThisBetter = {
  init(config: MakeThisBetterConfig): void {
    // SSR frameworks run the same component code on the server, where there is
    // no document at all — a widget cannot exist there, and throwing a
    // ReferenceError into the host's render pass is the one thing a
    // third-party SDK must never do.
    if (typeof document === 'undefined') return
    replaceInstance()
    lastConfig = config
    if (document.readyState === 'loading') {
      pendingMount = () => {
        pendingMount = null
        replaceInstance(config)
      }
      document.addEventListener('DOMContentLoaded', pendingMount, { once: true })
    } else {
      replaceInstance(config)
    }
  },

  destroy(): void {
    replaceInstance()
    lastConfig = null
  },

  setLocale(locale: string): void {
    if (lastConfig) lastConfig.locale = locale
    instance?.setLocale(locale)
  },

  /**
   * Opens annotation mode from the host's own UI. Pair with
   * `entryMode: 'api'` to replace the docked tab entirely, which is the only
   * good answer on a phone where a permanent floating control is in the way.
   */
  open(): void {
    instance?.open()
  },

  close(): void {
    instance?.close()
  },

  /** Shows the docked tab on non-touch devices. Mobile entry UI belongs to the host. */
  showLauncher(): void {
    instance?.showLauncher()
  },

  hideLauncher(): void {
    instance?.hideLauncher()
  },
}

export { MakeThisBetter }
export type { MakeThisBetterConfig }

if (typeof window !== 'undefined') {
  (window as Window & { MakeThisBetter?: typeof MakeThisBetter }).MakeThisBetter = MakeThisBetter

  document.addEventListener('turbo:load', () => {
    const host = document.getElementById(WIDGET_HOST_ID)
    if (lastConfig && (!host || !host.shadowRoot)) {
      host?.remove()
      replaceInstance(lastConfig)
    }
  })
}
