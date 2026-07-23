import { afterEach, describe, expect, it, vi } from 'vitest'
import { MakeThisBetter } from '../index'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
}))

vi.mock('@rrweb/record', () => {
  const record = Object.assign(() => () => {}, { addCustomEvent: () => {} })
  return { record }
})

function sessionFlowResponse(
  url: RequestInfo | URL,
  init: RequestInit | undefined,
  feedback: Record<string, unknown>,
  aiClarifyAvailable = false,
): Response {
  const href = String(url)
  if (init?.method === 'DELETE') return new Response(null, { status: 204 })
  if (href.endsWith('/feedback')) {
    return new Response(JSON.stringify({ feedback }), { status: 201 })
  }
  if (href.endsWith('/clarification')) {
    return new Response(JSON.stringify({
      clarification: { status: 'completed', messages: [], done: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({
    submission_session: {
      id: 'submission_1',
      token: 'submission-secret',
      ai_clarify_available: aiClarifyAvailable,
    },
  }), { status: 201 })
}

async function confirmSubmission(shadow: ShadowRoot): Promise<void> {
  await vi.waitFor(() => {
    expect(shadow.querySelector('.mtb-clarify-send-feedback')).not.toBeNull()
  })
  shadow.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!.click()
  await vi.waitFor(() => {
    expect(shadow.querySelector('.mtb-success')).not.toBeNull()
  })
}

function performDrawStroke(overlay: HTMLDivElement): void {
  overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }))
  for (let i = 1; i <= 5; i++) {
    overlay.dispatchEvent(new MouseEvent('mousemove', { clientX: 10 + i * 8, clientY: 10 + i * 8, bubbles: true }))
  }
  overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }))
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

describe('MakeThisBetter widget flow', () => {
  afterEach(() => {
    MakeThisBetter.destroy()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('creates a Session on Submit and finalizes Feedback only after Send feedback', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)

    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/feedback')) {
        return new Response(JSON.stringify({
          feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
        }), { status: 201 })
      }
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[{"role":"assistant","content":"All clear, thanks!"}],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
      }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1', email: 'user@example.com', name: 'User One' },
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))

    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    const feedbackPopup = shadow.querySelector<HTMLDivElement>('.mtb-popup')!
    const popupPosition = { left: feedbackPopup.style.left, top: feedbackPopup.style.top }
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[description]')).toBe('Export is broken')
    expect(formData.get('feedback[user_id]')).toBe('user_1')
    expect(formData.get('feedback[screenshot]')).toBeInstanceOf(File)
    expect(formData.get('feedback[target_element]')).toBe(JSON.stringify({
      selector: '#export-btn',
      text: 'Export PDF',
      name: 'Export PDF',
    }))
    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-clarify-send-feedback')).not.toBeNull()
    }, { timeout: 5000 })
    const clarification = shadow.querySelector<HTMLDivElement>('.mtb-clarify')!
    expect(clarification).toBe(feedbackPopup)
    expect(clarification.classList.contains('mtb-clarify-continuation')).toBe(true)
    expect({ left: clarification.style.left, top: clarification.style.top }).toEqual(popupPosition)
    expect(shadow.querySelector('.mtb-popup')).toBeNull()
    expect(shadow.querySelector('.mtb-clarify-ai')?.textContent).toBe('All clear, thanks!')
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(false)

    shadow.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!.click()

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-success-title')?.textContent).toBe('Sent — thanks!')
    }, { timeout: 5000 })

    expect(shadow.querySelector('.mtb-success-msg')?.textContent).toBe(
      'Your note and captured technical context are on their way to the team. You’ll hear back when it’s resolved.'
    )
    expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(true)
  })

  it('abandons the active Session on global Exit without finalizing Feedback', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (href.endsWith('/clarification')) {
        return new Response(JSON.stringify({
          clarification: {
            status: 'awaiting_response',
            messages: [{ role: 'assistant', content: 'What were you trying to do?' }],
            done: false,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    const tab = shadow.querySelector<HTMLButtonElement>('.mtb-tab')!
    tab.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-clarify')).not.toBeNull()
    })
    tab.click()

    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    })
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(false)
  })

  it('abandons a Session whose create response arrives after Exit', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let resolveCreate!: (response: Response) => void
    const createResponse = new Promise<Response>(resolve => { resolveCreate = resolve })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (String(url).endsWith('/feedback_submission_sessions')) return createResponse
      throw new Error(`Unexpected request: ${String(url)}`)
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    const tab = shadow.querySelector<HTMLButtonElement>('.mtb-tab')!
    tab.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback_submission_sessions'))).toBe(true)
    })
    tab.click()
    resolveCreate(new Response(JSON.stringify({
      submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
    }), { status: 201 }))

    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    })
    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/clarification'))).toBe(false)
  })

  it('does not show success when finalize completes after Exit', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let resolveFinalize!: (response: Response) => void
    const finalizeResponse = new Promise<Response>(resolve => { resolveFinalize = resolve })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (href.endsWith('/feedback')) return finalizeResponse
      if (href.endsWith('/clarification')) {
        return new Response(JSON.stringify({
          clarification: { status: 'completed', messages: [], done: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'proj_test', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    const tab = shadow.querySelector<HTMLButtonElement>('.mtb-tab')!
    tab.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-clarify-send-feedback')).not.toBeNull()
    })
    shadow.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!.click()

    // The explicit confirmation triggers the /feedback POST. That POST hangs
    // on finalizeResponse, so Exit can still invalidate the pending result.
    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(true)
    })
    tab.click()
    resolveFinalize(new Response(JSON.stringify({
      feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
    }), { status: 201 }))

    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    })
    expect(shadow.querySelector('.mtb-success')).toBeNull()
    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
  })

  it('submits anonymous feedback with a persistent anon_ reporter id', async () => {
    window.localStorage.clear()
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return sessionFlowResponse(url, init, { id: 'FB-1', status: 'received', project_id: 'acme' })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Anonymous feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })

    const formData = capturedBody as unknown as FormData
    const reporterId = formData.get('feedback[reporter_external_id]') as string
    expect(reporterId).toMatch(/^anon_/)
    expect(formData.get('feedback[user_id]')).toBeNull()
    expect(window.localStorage.getItem('mtb_anon_id')).toBe(reporterId)
  })

  it('shows View feedback for anonymous reporters when the server returns a handoff token', async () => {
    window.localStorage.clear()
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      return sessionFlowResponse(url, init, {
        id: 'FB-1',
        status: 'received',
        project_id: 'acme',
        board_url: 'https://acme.example.com',
        identity_token: 'tok_anon',
      })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Anonymous feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
    await confirmSubmission(shadow)

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-view-feedback-link')).not.toBeNull()
    }, { timeout: 5000 })

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    shadow.querySelector<HTMLButtonElement>('.mtb-view-feedback-link')!.click()
    expect(openSpy).toHaveBeenCalledWith('https://acme.example.com?identity=tok_anon', '_blank')
    expect(window.localStorage.getItem('mtb_board_url')).toBe('https://acme.example.com')
  })

  it('hides View feedback for anonymous reporters when no handoff token is returned', async () => {
    window.localStorage.clear()
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      return sessionFlowResponse(url, init, { id: 'FB-1', status: 'received', project_id: 'acme' })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Anonymous feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
    await confirmSubmission(shadow)

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-success-title')).not.toBeNull()
    }, { timeout: 5000 })

    expect(shadow.querySelector('.mtb-view-feedback-link')).toBeNull()
  })

  it('captures a reporter email on the success card and remembers it', async () => {
    window.localStorage.clear()
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    const patchCalls: { url: string; init: RequestInit }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCalls.push({ url: String(url), init: init! })
        return new Response(null, { status: 204 })
      }
      return sessionFlowResponse(url, init, {
        id: 'FB-1',
        status: 'received',
        project_id: 'acme',
        board_url: 'https://acme.example.com',
        identity_token: 'tok_anon',
      })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Anonymous feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
    await confirmSubmission(shadow)

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-email-input')).not.toBeNull()
    }, { timeout: 5000 })

    const emailInput = shadow.querySelector<HTMLInputElement>('.mtb-email-input')!
    emailInput.value = 'anon@example.com'
    shadow.querySelector<HTMLButtonElement>('.mtb-email-submit')!.click()

    await vi.waitFor(() => {
      expect(patchCalls.length).toBe(1)
    })

    expect(patchCalls[0].url).toBe('https://api.example.com/api/v1/widget/feedbacks/FB-1/reporter')
    const headers = patchCalls[0].init.headers as Record<string, string>
    expect(headers['X-Identity-Token']).toBe('tok_anon')
    expect(JSON.parse(String(patchCalls[0].init.body))).toEqual({ reporter: { email: 'anon@example.com' } })

    await vi.waitFor(() => {
      expect(window.localStorage.getItem('mtb_reporter_email')).toBe('anon@example.com')
    })
  })

  it('auto-includes the remembered email and skips the capture form', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('mtb_reporter_email', 'anon@example.com')
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return sessionFlowResponse(url, init, {
        id: 'FB-2',
        status: 'received',
        project_id: 'acme',
        board_url: 'https://acme.example.com',
        identity_token: 'tok_anon',
      })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Second feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
    await confirmSubmission(shadow)

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-success-title')).not.toBeNull()
    }, { timeout: 5000 })

    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[reporter_email]')).toBe('anon@example.com')
    expect(shadow.querySelector('.mtb-email-input')).toBeNull()
  })

  it('shows a My feedback footer link when a board url is cached', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('mtb_board_url', 'https://acme.example.com')
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    const postCalls: { url: string; body: string }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/widget/identity_tokens')) {
        postCalls.push({ url: String(url), body: String(init?.body) })
        return new Response(JSON.stringify({ identity_token: 'fresh_tok', board_url: 'https://acme.example.com' }), { status: 201 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))

    const link = shadow.querySelector<HTMLButtonElement>('.mtb-my-feedback')
    expect(link).not.toBeNull()

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    link!.click()

    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://acme.example.com?identity=fresh_tok', '_blank')
    })
    const anonId = window.localStorage.getItem('mtb_anon_id')
    expect(JSON.parse(postCalls[0].body)).toEqual({ reporter_external_id: anonId })
  })

  it('hides the My feedback link without a cached board url', async () => {
    window.localStorage.clear()
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))

    expect(shadow.querySelector('.mtb-my-feedback')).toBeNull()
  })

  it('hides the My feedback link for host-identity users', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('mtb_board_url', 'https://acme.example.com')
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1' },
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))

    expect(shadow.querySelector('.mtb-my-feedback')).toBeNull()
  })

  it('host identity takes over completely: no anon id, no remembered email', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('mtb_anon_id', 'anon_11111111-2222-3333-4444-555555555555')
    window.localStorage.setItem('mtb_reporter_email', 'anon@example.com')
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return sessionFlowResponse(url, init, { id: 'FB-3', status: 'received', project_id: 'acme' })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1', email: 'host@example.com' },
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Host feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })

    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[user_id]')).toBe('user_1')
    expect(formData.get('feedback[user_email]')).toBe('host@example.com')
    expect(formData.get('feedback[reporter_external_id]')).toBeNull()
    expect(formData.get('feedback[reporter_email]')).toBeNull()

    expect(window.localStorage.getItem('mtb_anon_id')).toBe('anon_11111111-2222-3333-4444-555555555555')
    expect(window.localStorage.getItem('mtb_reporter_email')).toBe('anon@example.com')
  })

  it('resumes the anonymous identity after the host user config disappears', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('mtb_anon_id', 'anon_11111111-2222-3333-4444-555555555555')
    window.localStorage.setItem('mtb_reporter_email', 'anon@example.com')
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return sessionFlowResponse(url, init, { id: 'FB-4', status: 'received', project_id: 'acme' })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1' },
    })
    MakeThisBetter.destroy()
    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Anonymous again'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })

    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[reporter_external_id]')).toBe('anon_11111111-2222-3333-4444-555555555555')
    expect(formData.get('feedback[reporter_email]')).toBe('anon@example.com')
    expect(formData.get('feedback[user_id]')).toBeNull()
  })

  it('uses the server board url for host-identity View feedback', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      return sessionFlowResponse(url, init, {
        id: 'FB-1',
        status: 'received',
        project_id: 'acme',
        board_url: 'https://acme.example.com',
      })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1' },
      userToken: 'host.signed.jwt',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Host feedback'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
    await confirmSubmission(shadow)

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-view-feedback-link')).not.toBeNull()
    }, { timeout: 5000 })

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    shadow.querySelector<HTMLButtonElement>('.mtb-view-feedback-link')!.click()
    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://acme.example.com?identity=host.signed.jwt', '_blank')
    })
  })

  it('requires Send feedback when AI clarification is unavailable', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)

    document.elementsFromPoint = vi.fn(() => [target])

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      return sessionFlowResponse(url, init, { id: 'FB-1', status: 'received', project_id: 'acme' })
    })

    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))

    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-clarify-send-feedback')).not.toBeNull()
    }, { timeout: 5000 })
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(false)

    shadow.querySelector<HTMLButtonElement>('.mtb-clarify-send-feedback')!.click()

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-success-title')?.textContent).toBe("Thanks! We've received your feedback.")
    }, { timeout: 5000 })

    expect(shadow.querySelector('.mtb-success-msg')?.textContent).toBe(
      "The team will take it from here. You'll hear back when it's resolved."
    )
    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(true)
  })

  it('never leaves an orphaned dim scrim when a pin popup is followed by a recording popup', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

    // Open a pin popup — this creates the first dim scrim.
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
    expect(shadow.querySelectorAll('.mtb-dim').length).toBe(1)

    // Switch to Record while the popup is still open.
    shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()

    // Stop the recording — this opens the recording popup.
    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-record-stop')).not.toBeNull()
    })
    shadow.querySelector<HTMLButtonElement>('.mtb-record-stop')!.click()

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-popup')).not.toBeNull()
    })

    // Exactly one dim scrim must remain — the first one is not orphaned.
    expect(shadow.querySelectorAll('.mtb-dim').length).toBe(1)

    // Dismissing the widget clears every scrim, keeping the host page interactive.
    shadow.querySelector<HTMLDivElement>('.mtb-dim')!.click()
    expect(shadow.querySelectorAll('.mtb-dim').length).toBe(0)
  })

  it('keeps one recording session when Replay is clicked twice', async () => {
    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    const replay = shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!

    replay.click()
    replay.click()

    await vi.waitFor(() => {
      expect(shadow.querySelectorAll('.mtb-record-bar')).toHaveLength(1)
    })
  })

  it('does not start a new feedback while the current one is being clarified', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (href.includes('/clarification')) {
        // Keep the conversation open (done:false) so the card stays mounted.
        return new Response(
          JSON.stringify({
            clarification: { status: 'active', messages: [{ role: 'assistant', content: 'What broke?' }], done: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    const tab = shadow.querySelector<HTMLButtonElement>('.mtb-tab')!
    tab.click()

    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
    overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
    overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))

    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

    // Clarify card mounts and stays (done:false).
    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-clarify')).not.toBeNull()
    }, { timeout: 5000 })
    expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
    shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()
    expect(shadow.querySelector('.mtb-record-bar')).toBeNull()

    // Clicking the tab now must NOT open a fresh annotation session.
    tab.click()
    expect(shadow.querySelector('.mtb-overlay')).toBeNull()
    expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
  })

  describe('Escape key', () => {
    it('does nothing while idle', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

      expect(() => pressEscape()).not.toThrow()
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
    })

    it('exits annotation mode back to idle', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()

      pressEscape()

      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).toBeNull()
    })

    it('cancels an in-progress drawing back to annotation mode, keeping the toolbar', async () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
      performDrawStroke(overlay)

      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull()
      })

      pressEscape()

      expect(shadow.querySelector('.mtb-draw-bar')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
    })

    it('exits an open comment popup back to idle', () => {
      const target = document.createElement('button')
      target.id = 'export-btn'
      document.body.appendChild(target)
      document.elementsFromPoint = vi.fn(() => [target])

      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
      overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
      expect(shadow.querySelector('.mtb-popup')).not.toBeNull()

      pressEscape()

      expect(shadow.querySelector('.mtb-popup')).toBeNull()
      expect(shadow.querySelector('.mtb-dim')).toBeNull()
    })

    it('stops an active recording, same as clicking Stop', async () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()

      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-record-bar')).not.toBeNull()
      })

      pressEscape()

      expect(shadow.querySelector('.mtb-record-bar')).toBeNull()
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-popup')).not.toBeNull()
      })
    })

    it('does nothing while a clarification conversation is open', async () => {
      const target = document.createElement('button')
      target.id = 'export-btn'
      document.body.appendChild(target)
      document.elementsFromPoint = vi.fn(() => [target])

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const href = String(url)
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        if (href.endsWith('/clarification')) {
          return new Response(JSON.stringify({
            clarification: { status: 'active', messages: [{ role: 'assistant', content: 'What broke?' }], done: false },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({
          submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
        }), { status: 201 })
      })

      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
      overlay.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, bubbles: true }))
      const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
      textarea.value = 'Export is broken'
      textarea.dispatchEvent(new Event('input'))
      shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-clarify')).not.toBeNull()
      }, { timeout: 5000 })

      // Snapshot before Escape: an unrelated prior test's fire-and-forget abandon
      // call can still land on this shared fetch spy, so only the delta from
      // pressing Escape (not the running total) tells us whether it acted.
      const deleteCallsBefore = fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE').length

      pressEscape()

      expect(shadow.querySelector('.mtb-clarify')).not.toBeNull()
      expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE').length).toBe(deleteCallsBefore)
    })

    it('stops listening after destroy', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      MakeThisBetter.destroy()

      expect(() => pressEscape()).not.toThrow()
    })
  })

  describe('setLocale', () => {
    it('updates the tab text when the locale changes at runtime', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

      expect(shadow.querySelector('.mtb-tab')!.textContent).toBe('Feedback')

      MakeThisBetter.setLocale('zh-CN')

      expect(shadow.querySelector('.mtb-tab')!.textContent).toBe('反馈')
    })

    it('reads document.documentElement.lang as the default locale', () => {
      document.documentElement.lang = 'zh-CN'
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

      expect(shadow.querySelector('.mtb-tab')!.textContent).toBe('反馈')
      document.documentElement.lang = ''
    })
  })

  describe('Turbo Drive navigation', () => {
    it('re-mounts the widget when turbo:load fires after body swap', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      expect(document.getElementById('mtb-widget-host')).not.toBeNull()

      document.body.innerHTML = ''
      expect(document.getElementById('mtb-widget-host')).toBeNull()

      document.dispatchEvent(new Event('turbo:load'))

      expect(document.getElementById('mtb-widget-host')).not.toBeNull()
      expect(document.getElementById('mtb-widget-host')!.shadowRoot).not.toBeNull()
    })

    it('does not re-mount when the host still exists', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const originalHost = document.getElementById('mtb-widget-host')!

      document.dispatchEvent(new Event('turbo:load'))

      expect(document.getElementById('mtb-widget-host')).toBe(originalHost)
    })

    it('does not re-mount after destroy', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      MakeThisBetter.destroy()
      document.body.innerHTML = ''

      document.dispatchEvent(new Event('turbo:load'))

      expect(document.getElementById('mtb-widget-host')).toBeNull()
    })
  })
})
