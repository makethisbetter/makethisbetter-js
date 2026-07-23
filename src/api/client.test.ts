import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiClient } from './client'
import type { FeedbackPayload } from '../types'

const mockPayload: FeedbackPayload = {
  description: 'Test feedback',
  page_url: 'https://example.com',
  user_agent: 'Mozilla/5.0',
  browser: 'Chrome 130',
  os: 'macOS',
  screen_width: 1440,
  screen_height: 900,
  console_errors: [],
  annotations: [],
}

describe('ApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST to correct URL with project key header', async () => {
    const jsonBody = JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 201 }),
    )

    const client = new ApiClient('acme123', 'https://api.example.com')
    await client.createSubmissionSession(mockPayload, null)

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/widget/feedback_submission_sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Project-Key': 'acme123' }),
      }),
    )
  })

  it('includes description in FormData', async () => {
    let capturedBody: FormData | null = null
    const jsonBody = JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body instanceof FormData ? init.body : null
      return new Response(jsonBody, { status: 201 })
    })

    const client = new ApiClient('key', 'https://api.example.com')
    await client.createSubmissionSession(mockPayload, null)

    expect(capturedBody).not.toBeNull()
    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[description]')).toBe('Test feedback')
  })

  it('uploads screenshot when present', async () => {
    let capturedBody: FormData | null = null
    const jsonBody = JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body instanceof FormData ? init.body : null
      return new Response(jsonBody, { status: 201 })
    })

    const screenshot = new Blob(['png'], { type: 'image/png' })
    const client = new ApiClient('key', 'https://api.example.com')
    await client.createSubmissionSession(mockPayload, screenshot)

    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[screenshot]')).toBeInstanceOf(File)
  })

  it('includes X-User-Token header when userToken is set', async () => {
    const jsonBody = JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 201 }),
    )

    const client = new ApiClient('key', 'https://api.example.com', 1000, 'jwt_static_token')
    await client.createSubmissionSession(mockPayload, null)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Project-Key': 'key',
          'X-User-Token': 'jwt_static_token',
        }),
      }),
    )
  })

  it('calls userTokenFn to get fresh token before each request', async () => {
    const jsonBody = JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 201 }),
    )

    const tokenFn = vi.fn(async () => 'jwt_dynamic_token')
    const client = new ApiClient('key', 'https://api.example.com', 1000, undefined, tokenFn)
    await client.createSubmissionSession(mockPayload, null)

    expect(tokenFn).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-User-Token': 'jwt_dynamic_token',
        }),
      }),
    )
  })

  it('prefers userTokenFn over static userToken', async () => {
    const jsonBody = JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 201 }),
    )

    const tokenFn = vi.fn(async () => 'from_fn')
    const client = new ApiClient('key', 'https://api.example.com', 1000, 'from_static', tokenFn)
    await client.createSubmissionSession(mockPayload, null)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-User-Token': 'from_fn',
        }),
      }),
    )
  })

  it('includes X-User-Token in startClarification', async () => {
    const jsonBody = JSON.stringify({ clarification: { status: 'pending', messages: [], done: false } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 200 }),
    )

    const client = new ApiClient('key', 'https://api.example.com', 1000, 'jwt_token')
    await client.startClarification('submission_1', 'secret', 'hello')

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Project-Key': 'key',
          'X-Submission-Token': 'secret',
          'X-User-Token': 'jwt_token',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('includes X-User-Token in getClarification', async () => {
    const jsonBody = JSON.stringify({ clarification: { status: 'done', messages: [], done: true } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 200 }),
    )

    const tokenFn = vi.fn(async () => 'jwt_dynamic')
    const client = new ApiClient('key', 'https://api.example.com', 1000, undefined, tokenFn)
    await client.getClarification('submission_1', 'secret')

    expect(tokenFn).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Project-Key': 'key',
          'X-Submission-Token': 'secret',
          'X-User-Token': 'jwt_dynamic',
        }),
      }),
    )
  })

  it('throws after retries exhausted', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    const client = new ApiClient('key', 'https://api.example.com', 0)
    await expect(client.createSubmissionSession(mockPayload, null)).rejects.toThrow()
  })

  it('reuses the idempotency key and submission token across retries', async () => {
    const calls: RequestInit[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      calls.push(init!)
      if (calls.length === 1) return new Response('oops', { status: 500 })
      return new Response(JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } }), { status: 201 })
    })

    const client = new ApiClient('acme123', 'https://api.example.com', 0)
    await client.createSubmissionSession(mockPayload, null)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const key1 = (calls[0].headers as Record<string, string>)['X-Idempotency-Key']
    const key2 = (calls[1].headers as Record<string, string>)['X-Idempotency-Key']
    const token1 = (calls[0].headers as Record<string, string>)['X-Submission-Token']
    const token2 = (calls[1].headers as Record<string, string>)['X-Submission-Token']
    expect(key1).toBeTruthy()
    expect(key2).toBe(key1)
    expect(token1.length).toBeGreaterThanOrEqual(32)
    expect(token2).toBe(token1)
  })

  it('streams clarify deltas and resolves the done result', async () => {
    const sse = [
      'event: delta\ndata: {"text":"Hi "}\n\n',
      'event: delta\ndata: {"text":"there"}\n\n',
      'event: done\ndata: {"done":true,"messages":[{"role":"assistant","content":"Hi there"}]}\n\n',
    ].join('')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    )

    const client = new ApiClient('key', 'https://api.example.com')
    const deltas: string[] = []
    const result = await client.streamClarification('submission_1', 'secret', (t) => deltas.push(t))

    expect(deltas).toEqual(['Hi ', 'there'])
    expect(result.done).toBe(true)
    expect(result.messages).toEqual([{ role: 'assistant', content: 'Hi there' }])
  })

  it('reports a failed clarify stream instead of treating it as complete', async () => {
    const sse = 'event: done\ndata: {"error":true,"done":true}\n\n'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    )

    const client = new ApiClient('key', 'https://api.example.com')
    const result = await client.streamClarification('submission_1', 'secret', () => {})

    expect(result.failed).toBe(true)
    expect(result.messages).toEqual([])
  })

  it('requests a retry for a failed clarification', async () => {
    const jsonBody = JSON.stringify({ clarification: { status: 'processing', messages: [], done: false } })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jsonBody, { status: 202 }),
    )

    const client = new ApiClient('key', 'https://api.example.com')
    await client.retryClarification('submission_1', 'secret')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/widget/feedback_submission_sessions/submission_1/clarification',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ retry: true }),
      }),
    )
  })

  it('throws from streamClarification when the server does not stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ done: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const client = new ApiClient('key', 'https://api.example.com')
    await expect(client.streamClarification('submission_1', 'secret', () => {})).rejects.toThrow()
  })

  it('uses a fresh idempotency key for each separate submission', async () => {
    const keys: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      keys.push((init!.headers as Record<string, string>)['X-Idempotency-Key'])
      return new Response(JSON.stringify({ submission_session: { id: 'submission_1', token: 'secret' } }), { status: 201 })
    })

    const client = new ApiClient('acme123', 'https://api.example.com')
    await client.createSubmissionSession(mockPayload, null)
    await client.createSubmissionSession(mockPayload, null)

    expect(keys[0]).toBeTruthy()
    expect(keys[0]).not.toBe(keys[1])
  })

  it('finalizes a submission session only with its token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ feedback: { id: 'FB-1', status: 'received', project_id: 'acme' } }), { status: 201 }),
    )

    const client = new ApiClient('key', 'https://api.example.com')
    const feedback = await client.finalizeSubmissionSession('submission_1', 'secret')

    expect(feedback.id).toBe('FB-1')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/widget/feedback_submission_sessions/submission_1/feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Submission-Token': 'secret' }),
      }),
    )
  })

  it('abandons a submission session on Exit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    const client = new ApiClient('key', 'https://api.example.com')
    await client.abandonSubmissionSession('submission_1', 'secret')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/widget/feedback_submission_sessions/submission_1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'X-Submission-Token': 'secret' }),
      }),
    )
  })
})
