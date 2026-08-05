import type {
  FeedbackPayload,
  FeedbackResponse,
  SubmissionSessionResponse,
  ClarifyResponse,
  ClarifyMessage,
} from '../types'
import { filterSensitiveText } from '../privacy/sanitize'

export interface ClarifyStreamResult {
  messages: ClarifyMessage[]
  done: boolean
  failed?: boolean
}

// Carries the HTTP status so callers can tell a retryable failure from a terminal
// one (e.g. 409 = the submission session is no longer accepting a finalize, which
// retrying can never fix). The message stays `HTTP <status>` for compatibility.
export class ApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isTerminalConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

// A finalize the reporter can no longer watch must still end. Without a ceiling
// a request that never settles leaves the widget mid-submission forever, with
// the launcher inert and nothing on screen to explain why.
export const FINALIZE_TIMEOUT_MS = 25_000

const DEFAULT_API_URL = 'https://makethisbetter.dev/api/v1'
const CAPTURE_POLICY = 'sensitive-data-v1'

export interface ApiClientOptions {
  projectKey: string
  apiUrl?: string
  retryDelayMs?: number
  userToken?: string
  userTokenFn?: () => Promise<string>
}

export class ApiClient {
  private apiUrl: string
  private projectKey: string
  private retryDelayMs: number
  private userToken?: string
  private userTokenFn?: () => Promise<string>

  constructor(options: ApiClientOptions) {
    this.projectKey = options.projectKey
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '')
    this.retryDelayMs = options.retryDelayMs ?? 1000
    this.userToken = options.userToken
    this.userTokenFn = options.userTokenFn
  }

  async resolveUserToken(): Promise<string | undefined> {
    if (this.userTokenFn) return this.userTokenFn()
    return this.userToken
  }

  private async authHeaders(contentType?: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'X-Project-Key': this.projectKey }
    const token = await this.resolveUserToken()
    if (token) headers['X-User-Token'] = token
    if (contentType) headers['Content-Type'] = contentType
    return headers
  }

  private async submissionHeaders(token: string, contentType?: string): Promise<Record<string, string>> {
    const headers = await this.authHeaders(contentType)
    headers['X-Submission-Token'] = token
    return headers
  }

  async createSubmissionSession(payload: FeedbackPayload, screenshot: Blob | null): Promise<SubmissionSessionResponse> {
    const submissionToken = generateSubmissionToken()
    const form = new FormData()
    form.append('feedback[description]', payload.description)
    form.append('feedback[page_url]', payload.page_url)
    form.append('feedback[user_agent]', payload.user_agent)
    form.append('feedback[browser]', payload.browser)
    form.append('feedback[os]', payload.os)
    form.append('feedback[screen_width]', String(payload.screen_width))
    form.append('feedback[screen_height]', String(payload.screen_height))
    form.append('feedback[console_errors]', JSON.stringify(payload.console_errors))
    form.append('feedback[annotations]', JSON.stringify(payload.annotations))

    if (payload.target_element) {
      form.append('feedback[target_element]', JSON.stringify(payload.target_element))
    }
    if (payload.user_id) form.append('feedback[user_id]', payload.user_id)
    if (payload.reporter_external_id) form.append('feedback[reporter_external_id]', payload.reporter_external_id)
    if (payload.reporter_email) form.append('feedback[reporter_email]', payload.reporter_email)
    if (payload.user_email) form.append('feedback[user_email]', payload.user_email)
    if (payload.user_name) form.append('feedback[user_name]', payload.user_name)

    if (payload.breadcrumbs && payload.breadcrumbs.length > 0) {
      form.append('feedback[breadcrumbs]', JSON.stringify(payload.breadcrumbs))
    }

    if (payload.recording_events && payload.recording_events.length > 0) {
      const json = JSON.stringify(payload.recording_events)
      const blob = new Blob([json], { type: 'application/json' })
      form.append('feedback[recording]', blob, 'interaction-replay.json')
      form.append('feedback[recording_duration]', String(payload.recording_duration ?? 0))
    }

    if (screenshot) {
      const ext = screenshot.type === 'image/jpeg' ? 'jpg' : 'png'
      form.append('feedback[screenshot]', screenshot, `screenshot.${ext}`)
    }

    const headers = await this.authHeaders()
    headers['X-Submission-Token'] = submissionToken
    headers['X-MTB-Capture-Policy'] = CAPTURE_POLICY
    // One key per submission, reused across retries: if the first POST
    // reached the server but the response was lost, the retry must not
    // create a second feedback.
    headers['X-Idempotency-Key'] = generateIdempotencyKey()
    const res = await this.fetchWithRetry(`${this.apiUrl}/widget/feedback_submission_sessions`, {
      method: 'POST',
      headers,
      body: form,
    })
    const body = await res.json() as {
      submission_session: Omit<SubmissionSessionResponse, 'token'> & { token?: string }
    }
    return { ...body.submission_session, token: submissionToken }
  }

  async createIdentityToken(reporterExternalId: string): Promise<{ identity_token: string; board_url: string } | null> {
    const headers = await this.authHeaders('application/json')
    try {
      const res = await this.fetchWithRetry(`${this.apiUrl}/widget/identity_tokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reporter_external_id: reporterExternalId }),
      })
      return await res.json()
    } catch {
      return null
    }
  }

  async updateReporter(feedbackId: string, email: string, identityToken: string): Promise<boolean> {
    const headers = await this.authHeaders('application/json')
    headers['X-Identity-Token'] = identityToken
    try {
      await this.fetchWithRetry(`${this.apiUrl}/widget/feedbacks/${feedbackId}/reporter`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ reporter: { email } }),
      })
      return true
    } catch {
      return false
    }
  }

  async startClarification(submissionSessionId: string, token: string, message?: string): Promise<ClarifyResponse> {
    const body: Record<string, string | boolean> = {}
    if (message) body.message = filterSensitiveText(message)
    return this.requestClarification(submissionSessionId, token, body)
  }

  async retryClarification(submissionSessionId: string, token: string): Promise<ClarifyResponse> {
    return this.requestClarification(submissionSessionId, token, { retry: true })
  }

  private async requestClarification(
    submissionSessionId: string,
    token: string,
    body: Record<string, string | boolean>,
  ): Promise<ClarifyResponse> {
    const headers = await this.submissionHeaders(token, 'application/json')
    const res = await this.fetchWithRetry(`${this.apiUrl}/widget/feedback_submission_sessions/${submissionSessionId}/clarification`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const response = await res.json() as { clarification: ClarifyResponse }
    return response.clarification
  }

  async getClarification(submissionSessionId: string, token: string): Promise<ClarifyResponse> {
    const headers = await this.submissionHeaders(token)
    const res = await this.fetchWithRetry(`${this.apiUrl}/widget/feedback_submission_sessions/${submissionSessionId}/clarification`, {
      method: 'GET',
      headers,
    })
    const response = await res.json() as { clarification: ClarifyResponse }
    return response.clarification
  }

  // Streams a clarification turn over SSE. Calls onDelta for each token and
  // resolves with the committed result. Throws if the server doesn't stream
  // (e.g. old backend returns JSON) so the caller can fall back to polling.
  async streamClarification(
    submissionSessionId: string,
    token: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ClarifyStreamResult> {
    const headers = await this.submissionHeaders(token, 'application/json')
    headers['Accept'] = 'text/event-stream'

    const res = await fetch(`${this.apiUrl}/widget/feedback_submission_sessions/${submissionSessionId}/clarification`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal,
    })

    const contentType = res.headers.get('Content-Type') ?? ''
    if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
      throw new Error('clarify stream unavailable')
    }

    return consumeSse(res.body, onDelta)
  }

  // No X-Idempotency-Key here, unlike createSubmissionSession: the session id in
  // the path already is one. The server finalizes under a row lock and returns
  // the feedback it already created if the session is finalized, so the retry
  // fetchWithRetry makes after a 5xx cannot produce a second Feedback.
  async finalizeSubmissionSession(submissionSessionId: string, token: string): Promise<FeedbackResponse> {
    const headers = await this.submissionHeaders(token)
    const controller = new AbortController()
    // Covers both attempts, so the caller waits the ceiling once rather than
    // once per retry.
    const timer = setTimeout(() => controller.abort(), FINALIZE_TIMEOUT_MS)
    try {
      const res = await this.fetchWithRetry(`${this.apiUrl}/widget/feedback_submission_sessions/${submissionSessionId}/feedback`, {
        method: 'POST',
        headers,
        signal: controller.signal,
      })
      const response = await res.json() as { feedback: FeedbackResponse }
      return response.feedback
    } finally {
      clearTimeout(timer)
    }
  }

  async abandonSubmissionSession(submissionSessionId: string, token: string): Promise<void> {
    const headers = await this.submissionHeaders(token)
    await this.fetchWithRetry(`${this.apiUrl}/widget/feedback_submission_sessions/${submissionSessionId}`, {
      method: 'DELETE',
      headers,
    })
  }

  private async fetchWithRetry(url: string, init: RequestInit, retries = 1): Promise<Response> {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (err) {
      // An aborted request has spent its deadline; retrying only makes the
      // caller wait out the retry delay for a second guaranteed abort.
      if (retries > 0 && !init.signal?.aborted) {
        await delay(this.retryDelayMs)
        return this.fetchWithRetry(url, init, retries - 1)
      }
      throw err
    }

    if (res.ok) return res
    if (res.status >= 500 && retries > 0) {
      await delay(this.retryDelayMs)
      return this.fetchWithRetry(url, init, retries - 1)
    }
    throw new ApiError(res.status)
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<ClarifyStreamResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ClarifyStreamResult | null = null

  const flush = (raw: string): void => {
    // Each SSE record is "event: <name>\n data: <json>". Parse event + data.
    const eventLine = raw.split('\n').find(l => l.startsWith('event:'))
    const dataLine = raw.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) return
    const event = eventLine?.slice(6).trim()
    const payload = JSON.parse(dataLine.slice(5).trim())
    if (event === 'delta' && typeof payload.text === 'string') {
      onDelta(payload.text)
    } else if (event === 'done') {
      result = {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        done: payload.done !== false,
        failed: payload.error === true,
      }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      try { flush(record) } catch { /* skip malformed record */ }
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    try { flush(buffer) } catch { /* handled by the missing done check below */ }
  }
  if (!result) throw new Error('clarify stream ended before done')

  return result
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function generateSubmissionToken(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable')
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
