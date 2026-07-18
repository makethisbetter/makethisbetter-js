import { afterEach, describe, expect, it, vi } from 'vitest'
import { MakeThisBetter } from '../index'

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,AA=='),
}))

describe('MakeThisBetter widget flow', () => {
  afterEach(() => {
    MakeThisBetter.destroy()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('submits feedback from a pin annotation', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)

    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({ id: 'fb_1', status: 'open', project_id: 'proj_test', messages: [], done: true }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1', email: 'user@example.com', name: 'User One' },
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
      expect(shadow.querySelector('.mtb-success-title')?.textContent).toBe('Thanks!')
    }, { timeout: 5000 })

    expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
  })

  it('submits anonymous feedback with a persistent anon_ reporter id', async () => {
    window.localStorage.clear()
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    let capturedBody: FormData | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({ id: 'fb_1', status: 'open', project_id: 'proj_test', ai_clarify_available: false }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        id: 'fb_1',
        status: 'open',
        project_id: 'proj_test',
        ai_clarify_available: false,
        board_url: 'https://acme.example.com',
        identity_token: 'tok_anon',
      }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ id: 'fb_1', status: 'open', project_id: 'proj_test', ai_clarify_available: false }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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
      return new Response(JSON.stringify({
        id: 'fb_1',
        status: 'open',
        project_id: 'proj_test',
        ai_clarify_available: false,
        board_url: 'https://acme.example.com',
        identity_token: 'tok_anon',
      }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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
      expect(shadow.querySelector('.mtb-email-input')).not.toBeNull()
    }, { timeout: 5000 })

    const emailInput = shadow.querySelector<HTMLInputElement>('.mtb-email-input')!
    emailInput.value = 'anon@example.com'
    shadow.querySelector<HTMLButtonElement>('.mtb-email-submit')!.click()

    await vi.waitFor(() => {
      expect(patchCalls.length).toBe(1)
    })

    expect(patchCalls[0].url).toBe('https://api.example.com/api/v1/widget/feedbacks/fb_1/reporter')
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({
        id: 'fb_2',
        status: 'open',
        project_id: 'proj_test',
        ai_clarify_available: false,
        board_url: 'https://acme.example.com',
        identity_token: 'tok_anon',
      }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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
      projectKey: 'proj_test',
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
      projectKey: 'proj_test',
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
      projectKey: 'proj_test',
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({ id: 'fb_3', status: 'open', project_id: 'proj_test', ai_clarify_available: false }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({ id: 'fb_4', status: 'open', project_id: 'proj_test', ai_clarify_available: false }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1' },
    })
    MakeThisBetter.destroy()
    MakeThisBetter.init({
      projectKey: 'proj_test',
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        id: 'fb_1',
        status: 'open',
        project_id: 'proj_test',
        ai_clarify_available: false,
        board_url: 'https://acme.example.com',
      }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-view-feedback-link')).not.toBeNull()
    }, { timeout: 5000 })

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    shadow.querySelector<HTMLButtonElement>('.mtb-view-feedback-link')!.click()
    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://acme.example.com?identity=host.signed.jwt', '_blank')
    })
  })

  it('skips the AI clarify chat when ai_clarify_available is false', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)

    document.elementsFromPoint = vi.fn(() => [target])

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ id: 'fb_1', status: 'open', project_id: 'proj_test', ai_clarify_available: false }), { status: 201 })
    })

    MakeThisBetter.init({
      projectKey: 'proj_test',
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
      expect(shadow.querySelector('.mtb-success-title')?.textContent).toBe('Sent — thanks!')
    }, { timeout: 5000 })

    expect(shadow.querySelector('.mtb-success-msg')?.textContent).toBe(
      "We'll take it from here. You'll hear back when it's resolved."
    )
    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not start a new feedback while the current one is being clarified', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (href.includes('/clarify')) {
        // Keep the conversation open (done:false) so the card stays mounted.
        return new Response(
          JSON.stringify({ status: 'active', messages: [{ role: 'assistant', content: 'What broke?' }], done: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ id: 'fb_1', status: 'open', project_id: 'proj_test', messages: [] }), { status: 201 })
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

    // Clarify card mounts and stays (done:false).
    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-clarify')).not.toBeNull()
    }, { timeout: 5000 })

    // Clicking the tab now must NOT open a fresh annotation session.
    tab.click()
    expect(shadow.querySelector('.mtb-overlay')).toBeNull()
    expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
  })
})
