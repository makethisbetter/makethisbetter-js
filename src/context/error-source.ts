export interface ErrorSourceEvent {
  message: string
  source?: string
  line?: number
  col?: number
  error?: unknown
}

type ErrorListener = (event: ErrorSourceEvent) => void

class ErrorSource {
  private listeners = new Set<ErrorListener>()
  private originalOnError: OnErrorEventHandler | null = null
  private installedOnError: OnErrorEventHandler | null = null
  private rejectionHandler: ((e: PromiseRejectionEvent) => void) | null = null
  private hooked = false

  subscribe(listener: ErrorListener): () => void {
    this.listeners.add(listener)
    this.hook()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.unhook()
    }
  }

  private hook(): void {
    if (this.hooked) return
    this.hooked = true

    this.originalOnError = window.onerror
    this.installedOnError = (msg, source, line, col, error) => {
      this.emit({ message: String(msg), source, line, col, error })
      if (this.originalOnError) {
        return this.originalOnError.call(window, msg, source, line, col, error)
      }
      return false
    }
    window.onerror = this.installedOnError

    this.rejectionHandler = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason)
      this.emit({ message: `Unhandled rejection: ${reason}` })
    }
    window.addEventListener('unhandledrejection', this.rejectionHandler)
  }

  private unhook(): void {
    if (!this.hooked) return
    this.hooked = false
    // Only restore if nothing replaced our handler meanwhile — restoring
    // the stale snapshot would clobber a handler the page installed later.
    if (window.onerror === this.installedOnError) {
      window.onerror = this.originalOnError
    }
    this.installedOnError = null
    this.originalOnError = null
    if (this.rejectionHandler) {
      window.removeEventListener('unhandledrejection', this.rejectionHandler)
      this.rejectionHandler = null
    }
  }

  private emit(event: ErrorSourceEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export const errorSource = new ErrorSource()
