const STORAGE_KEY = 'mtb_anon_id'
const EMAIL_KEY = 'mtb_reporter_email'
const BOARD_URL_KEY = 'mtb_board_url'

let memoryId: string | null = null
let memoryEmail: string | null = null
let memoryBoardUrl: string | null = null

export function getAnonId(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored?.startsWith('anon_')) return stored
    const id = generateAnonId()
    window.localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    memoryId ??= generateAnonId()
    return memoryId
  }
}

export function getStoredReporterEmail(): string | undefined {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? undefined
  } catch {
    return memoryEmail ?? undefined
  }
}

export function rememberReporterEmail(email: string): void {
  memoryEmail = email
  try {
    window.localStorage.setItem(EMAIL_KEY, email)
  } catch {
    // localStorage unavailable — the in-memory copy covers this session
  }
}

export function getCachedBoardUrl(): string | undefined {
  try {
    return window.localStorage.getItem(BOARD_URL_KEY) ?? undefined
  } catch {
    return memoryBoardUrl ?? undefined
  }
}

export function cacheBoardUrl(url: string): void {
  memoryBoardUrl = url
  try {
    window.localStorage.setItem(BOARD_URL_KEY, url)
  } catch {
    // localStorage unavailable — the in-memory copy covers this session
  }
}

function generateAnonId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `anon_${crypto.randomUUID()}`
  }
  const random = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
  return `anon_${random}`
}
