import { errorSource, type ErrorSourceEvent } from './error-source'
import { summarizeError } from './error-summary'

const MAX_CONSOLE_ERRORS = 20

export class ConsoleErrorCollector {
  private errors: string[] = []
  private unsubscribe: (() => void) | null = null

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = errorSource.subscribe((e) => this.record(e))
  }

  private record(e: ErrorSourceEvent): void {
    this.addError(summarizeError(e))
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
