import { errorSource, type ErrorSourceEvent } from './error-source'

const MAX_CONSOLE_ERRORS = 20

export class ConsoleErrorCollector {
  private errors: string[] = []
  private unsubscribe: (() => void) | null = null

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = errorSource.subscribe((e) => this.record(e))
  }

  private record(e: ErrorSourceEvent): void {
    const location = e.line != null ? ` (${e.line}:${e.col ?? 0})` : ''
    this.addError(`${e.message}${location}`)
  }

  private addError(msg: string): void {
    if (this.errors.length >= MAX_CONSOLE_ERRORS) return
    if (!this.errors.includes(msg)) {
      this.errors.push(msg)
    }
  }

  getErrors(): string[] {
    return [...this.errors]
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
