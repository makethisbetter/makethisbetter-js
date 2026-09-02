import type { ErrorSourceEvent } from './error-source'

export function summarizeError(event: ErrorSourceEvent): string {
  const name = validErrorName(event.name) || inferErrorName(event.message)
  const location = errorLocation(event)
  return location ? `${name} (${location})` : name
}

function validErrorName(name: string | undefined): string {
  return name && /^[A-Za-z][A-Za-z0-9]*(?:Error|Exception|Rejection)$/.test(name) ? name : ''
}

function inferErrorName(message: string): string {
  return message.match(/^([A-Za-z][A-Za-z0-9]*(?:Error|Exception))\b/)?.[1] ?? 'Error'
}

function errorLocation(event: ErrorSourceEvent): string {
  if (!event.source) return ''

  try {
    const pathname = new URL(event.source, window.location.href).pathname
    if (event.line == null) return pathname
    return `${pathname}:${event.line}:${event.col ?? 0}`
  } catch {
    return ''
  }
}
