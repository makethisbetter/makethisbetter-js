import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MakeThisBetter } from '../index'
import { getMessages } from '../i18n'
// jsdom has no matchMedia, and the scroll lock asks it whether a finger is
// driving. Absent means "mouse" to the production code, so touch is declared.
function setPointerCoarse(coarse: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
  })) as unknown as typeof window.matchMedia
}

import {
  clearFrustrationState,
  isFrustrationDismissed,
  loadFrustrationState,
  saveFrustrationState,
} from '../context/frustration-state'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
  getFontEmbedCSS: vi.fn(async () => ''),
}))

vi.mock('@rrweb/record', () => {
  // One synthetic snapshot on start, matching reality — rrweb always emits a
  // full snapshot immediately. Without it every recorded session tested here
  // is empty, and the client silently omits empty recordings from the
  // payload, so no test could ever see feedback[recording].
  const record = Object.assign((opts?: { emit?: (e: unknown) => void }) => {
    opts?.emit?.({ type: 2, data: {}, timestamp: 0 })
    return () => {}
  }, { addCustomEvent: () => {} })
  return { record }
})

class ImmediatelyLoadingImage {
  naturalWidth = 1280
  naturalHeight = 720
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onload?.())
  }
}

function screenshotCanvasContext(): CanvasRenderingContext2D {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

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
  overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, composed: true }))
  for (let i = 1; i <= 5; i++) {
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 10 + i * 8, clientY: 10 + i * 8, bubbles: true }))
  }
  overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

function openCardWithPin(shadow: ShadowRoot): void {
  shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
  const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
  overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 30, bubbles: true }))
  overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 30, bubbles: true }))
}

function typeAndSubmit(shadow: ShadowRoot, description = 'Export is broken'): void {
  const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
  textarea.value = description
  textarea.dispatchEvent(new Event('input'))
  shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
}

function openCardTypeAndSubmit(shadow: ShadowRoot, description = 'Export is broken'): void {
  openCardWithPin(shadow)
  typeAndSubmit(shadow, description)
}

async function submitDescriptionAndSkipClarification(shadow: ShadowRoot): Promise<void> {
  openCardTypeAndSubmit(shadow)
  await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify-skip')).not.toBeNull())
  shadow.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()
}

describe('MakeThisBetter widget flow', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', ImmediatelyLoadingImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(screenshotCanvasContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
    })
  })

  afterEach(() => {
    MakeThisBetter.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setPointerCoarse(false)
    document.body.innerHTML = ''
    // jsdom does not model touch-action: assigning it lands an ad-hoc property
    // on the style object that never reaches cssText, so removeAttribute alone
    // leaves it set and it bleeds into the next test.
    document.body.style.overflow = ''
    document.body.style.touchAction = ''
    document.body.removeAttribute('style')
  })

  // The host page is deliberately left alone while annotating. What makes a
  // finger able to draw is `touch-action: none` on the overlay, which covers
  // the viewport — so a finger on it cannot scroll the page in the first
  // place. Locking the body as well added nothing and cost three defects: on
  // iOS `overflow: hidden` there does nothing (the scroller is the document
  // element), moving it to the document element lost the scroll position, and
  // taking the body out of flow scrolled the page on the way in and out.
  describe('the host page while annotating', () => {
    beforeEach(() => { setPointerCoarse(true) })
    afterEach(() => { setPointerCoarse(false) })

    // open() rather than a tab click: touch gets no launcher of ours, so this
    // is the only way in — the same one a host site's own button uses.
    function openMarkup(): ShadowRoot {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      MakeThisBetter.open()
      return shadow
    }

    // A finger draws; it does not point. Hitting a 40px control on a phone is
    // fiddly, and the habit people already have is to scribble over what is
    // wrong. Making a tap inert also retires the family of defects where one
    // carried meaning it should not have — "the tap did nothing", "a stray dot
    // appeared" — because now there is nothing for it to get wrong.
    it('ignores a tap: a finger draws rather than points', () => {
      const shadow = openMarkup()
      const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!

      overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 30, bubbles: true }))
      overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 30, bubbles: true }))

      expect(shadow.querySelector('.mtb-popup')).toBeNull()
      expect(shadow.querySelector('.mtb-pin')).toBeNull()
    })

    it('still opens the note surface for an actual stroke', () => {
      const shadow = openMarkup()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

      expect(shadow.querySelector('.mtb-popup')).not.toBeNull()
    })

    it('dismisses the coach mark without consuming the first stroke', () => {
      const shadow = openMarkup()
      const hint = shadow.querySelector('.mtb-hint-bar')!

      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

      expect(hint.classList.contains('mtb-hint-bar--dismissed')).toBe(true)
      expect(shadow.querySelector('.mtb-popup')).not.toBeNull()
    })

    it('shows the coach mark only once in the widget lifetime', () => {
      const shadow = openMarkup()
      expect(shadow.querySelector('.mtb-hint-bar')!.classList.contains('mtb-hint-bar--dismissed')).toBe(false)

      MakeThisBetter.close()
      MakeThisBetter.open()

      expect(shadow.querySelector('.mtb-hint-bar')!.classList.contains('mtb-hint-bar--dismissed')).toBe(true)
    })

    // The tab is 36x40 of someone else's screen and hard to find — its own
    // author missed it on a test page. Where a feedback entry belongs on a
    // narrow screen is the host's call, so touch gets none by default.
    it('renders no launcher of its own', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

      expect(shadow.querySelector('.mtb-tab')).toBeNull()
    })

    it('does not render its launcher when the host calls showLauncher()', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      MakeThisBetter.showLauncher()
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

      expect(shadow.querySelector('.mtb-tab')).toBeNull()
    })

    it('leaves the body untouched on entering markup', () => {
      document.body.style.overflow = 'auto'
      openMarkup()

      expect(document.body.style.overflow).toBe('auto')
      expect(document.body.style.position).toBe('')
    })

    it('leaves the body untouched on exit', () => {
      const shadow = openMarkup()
      shadow.querySelector<HTMLButtonElement>('.mtb-exit-btn')!.click()

      // An empty style attribute may remain — what matters is that no value
      // the widget wrote is still in force.
      expect(document.body.style.cssText).toBe('')
    })

    // The bar is a full-bleed strip at the top on a phone. Overlapping, it
    // covered ~100px of the page — a real device showed every tap in that band
    // doing nothing, with no explanation.
    it('gives the top bar room of its own rather than covering the page', () => {
      openMarkup()

      expect(parseFloat(document.body.style.paddingTop || '0')).toBeGreaterThan(0)
    })

    it('gives the room back on exit', () => {
      const shadow = openMarkup()
      shadow.querySelector<HTMLButtonElement>('.mtb-exit-btn')!.click()

      expect(document.body.style.paddingTop).toBe('')
    })

    it('does not reserve room for a mouse, where the bar floats', () => {
      setPointerCoarse(false)
      openMarkup()

      expect(document.body.style.paddingTop).toBe('')
    })

    // The overlay is what actually stops a finger scrolling the page, and it
    // is the reason no body manipulation is needed. Asserted against the rule
    // rather than the computed value: jsdom does not model touch-action.
    it('covers the viewport with a surface that refuses pan gestures', () => {
      const shadow = openMarkup()

      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
      const sheet = shadow.querySelector('style')!.textContent!
      const rule = sheet.slice(sheet.indexOf('.mtb-overlay {'))
      expect(rule.slice(0, rule.indexOf('}'))).toContain('touch-action: none')
    })
  })

  // Strokes and note cards are positioned in viewport coordinates. The page
  // scrolls freely while the reporter is browsing or recording, and locks
  // once a stroke or note card is on screen.
  describe('the host page scroll lock', () => {
    function scrollPage(): boolean {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
      document.body.dispatchEvent(event)
      return !event.defaultPrevented
    }

    function openWidget(): ShadowRoot {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      return document.getElementById('mtb-widget-host')!.shadowRoot!
    }

    it('scrolls freely while the reporter is browsing', () => {
      const shadow = openWidget()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

      expect(scrollPage()).toBe(true)
    })

    it('holds still once the note card is up', () => {
      openCardWithPin(openWidget())

      expect(scrollPage()).toBe(false)
    })

    it('scrolls again after the card is dismissed', () => {
      const shadow = openWidget()
      openCardWithPin(shadow)
      pressEscape()

      expect(scrollPage()).toBe(true)
    })

    // The pin is gone by then — the note has been submitted and the follow-up
    // conversation is anchored to nothing on the page.
    it('scrolls again once the note is submitted', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
        sessionFlowResponse(url, init, { id: 'fb_1', reference: 'acme/FB-1' }))
      const shadow = openWidget()
      openCardTypeAndSubmit(shadow)
      await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify')).not.toBeNull())

      expect(scrollPage()).toBe(true)
    })

    it('leaves nothing listening after the widget is destroyed', () => {
      openCardWithPin(openWidget())
      MakeThisBetter.destroy()

      expect(scrollPage()).toBe(true)
    })

    it('releases scroll lock when destroyed while a note card is up', () => {
      openCardWithPin(openWidget())
      expect(scrollPage()).toBe(false)

      MakeThisBetter.destroy()
      expect(scrollPage()).toBe(true)
    })
  })

  it('creates a Session on Submit and finalizes Feedback after AI clarification completes', async () => {
    // Run this one as a touch device: the freeze only engages there, and the
    // assertion at the end of this flow is what guards against leaving the
    // host page stranded after a successful submit.
    setPointerCoarse(true)

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
    MakeThisBetter.open()

    // A stroke, not a tap: on touch a tap carries no meaning. The
    // target_element assertion below is the point of running it this way — the
    // element identity a pin used to supply is now read back from where the
    // stroke landed, so a reporter who scribbles still tells the board which
    // control they meant.
    performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

    // Asserted before the flow continues so the restore check at the end of the
    // test cannot pass vacuously: it only means something if room was reserved.
    expect(parseFloat(document.body.style.paddingTop || '0')).toBeGreaterThan(0)

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
      expect(shadow.querySelector('.mtb-success-title')?.textContent).toBe('Sent — thanks!')
    }, { timeout: 5000 })
    expect(feedbackPopup.classList.contains('mtb-clarify-continuation')).toBe(true)
    expect({ left: feedbackPopup.style.left, top: feedbackPopup.style.top }).toEqual(popupPosition)
    expect(shadow.querySelector('.mtb-popup')).toBeNull()
    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(true)

    expect(shadow.querySelector('.mtb-success-msg')?.textContent).toBe(
      'Your note and captured technical context are on their way to the team. You’ll hear back when it’s resolved.'
    )
    expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(true)

    // Submitting is the path most reporters take, and it never passes through
    // exitAll. The toolbar is gone by now, so the strip reserved for it has to
    // be gone too — otherwise the host page keeps the padding for the rest of
    // its life, which on a single-page app means until the next full reload.
    expect(document.body.style.paddingTop).toBe('')
  })

  it('leaves annotation mode immediately when clarification is skipped', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    const tab = shadow.querySelector<HTMLButtonElement>('.mtb-tab')!
    openCardTypeAndSubmit(shadow)

    shadow.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()

    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
    expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
    expect(shadow.querySelector('.mtb-overlay')).toBeNull()
    expect(tab.classList.contains('active')).toBe(false)
  })

  // Declining the screenshot has to mean the page is never rasterized at all,
  // not that a bitmap is taken and then dropped: a picture the reporter said no
  // to should not exist in the first place.
  it('never rasterizes the page once the reporter unticks the screenshot', async () => {
    const { toJpeg } = await import('html-to-image')
    const toJpegMock = vi.mocked(toJpeg)

    const pinTarget = document.createElement('button')
    pinTarget.id = 'export-btn'
    pinTarget.textContent = 'Export PDF'
    document.body.appendChild(pinTarget)
    document.elementsFromPoint = vi.fn(() => [pinTarget])

    // Drain captures still resolving from earlier tests' popups so the counts
    // below only measure this flow.
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    toJpegMock.mockClear()

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
          'event: done\ndata: {"messages":[{"role":"assistant","content":"All clear!"}],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (init?.body instanceof FormData) capturedBody = init.body
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

    openCardWithPin(shadow)

    const box = shadow.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
    box.checked = false
    box.dispatchEvent(new Event('change'))

    typeAndSubmit(shadow, 'the sidebar is empty')

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())

    const formData = capturedBody as unknown as FormData
    expect(formData.get('feedback[description]')).toBe('the sidebar is empty')
    // The report still goes: only the picture is withheld.
    expect(formData.get('feedback[screenshot]')).toBeNull()
    expect(formData.get('feedback[target_element]')).not.toBeNull()
    expect(toJpegMock).not.toHaveBeenCalled()
  })

  // Switching the toolbar back to Markup from an open note popup used to
  // leave the popup, its scrim and the scroll lock on screen — a zombie whose
  // checkbox change-listener was still a live consent writer. The abandoned
  // note surface must come down, and annotating must actually work again.
  it('tears the note popup down when the toolbar returns to markup', async () => {
    const pinTarget = document.createElement('button')
    pinTarget.id = 'export-btn'
    pinTarget.textContent = 'Export PDF'
    document.body.appendChild(pinTarget)
    document.elementsFromPoint = vi.fn(() => [pinTarget])

    const bodies: FormData[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/feedback')) {
        return new Response(JSON.stringify({
          feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
        }), { status: 201 })
      }
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[{"role":"assistant","content":"All clear!"}],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (init?.body instanceof FormData) bodies.push(init.body)
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: false },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

    // Open a pin popup and decline the screenshot there, then abandon the note
    // by switching the toolbar back to Markup.
    openCardWithPin(shadow)
    const box = shadow.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
    box.checked = false
    box.dispatchEvent(new Event('change'))
    shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-markup')!.click()

    // The abandoned surface is gone entirely — no zombie checkbox, no scrim,
    // no scroll lock left on the host page.
    expect(shadow.querySelector('.mtb-popup')).toBeNull()
    expect(shadow.querySelector('.mtb-screenshot-opt')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')

    // Annotating works again: a drawing made now carries its screenshot, and
    // no stale writer can strip it away.
    const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')
    expect(overlay).not.toBeNull()
    performDrawStroke(overlay!)
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull())
    const input = shadow.querySelector<HTMLInputElement>('.mtb-draw-input')!
    input.value = 'the export button is dead'
    input.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-draw-submit')!.click()

    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    await vi.waitFor(() => {
      expect(bodies[bodies.length - 1]!.get('feedback[screenshot]')).toBeInstanceOf(File)
    })
  })

  // A successful submit does not route through exitAll, so nothing used to
  // clear the declined consent afterwards: the next report opened with a
  // ticked box and silently sent no screenshot.
  it('hands the next report a fresh screenshot consent after a successful submit', async () => {
    const { toJpeg } = await import('html-to-image')
    const toJpegMock = vi.mocked(toJpeg)

    const pinTarget = document.createElement('button')
    pinTarget.id = 'export-btn'
    pinTarget.textContent = 'Export PDF'
    document.body.appendChild(pinTarget)
    document.elementsFromPoint = vi.fn(() => [pinTarget])

    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    toJpegMock.mockClear()

    const bodies: FormData[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/feedback')) {
        return new Response(JSON.stringify({
          feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
        }), { status: 201 })
      }
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[{"role":"assistant","content":"All clear!"}],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (init?.body instanceof FormData) bodies.push(init.body)
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: false },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

    // First report: decline the screenshot and see it through to success.
    openCardWithPin(shadow)
    const first = shadow.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
    first.checked = false
    first.dispatchEvent(new Event('change'))
    typeAndSubmit(shadow, 'first report')

    await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify-skip')).not.toBeNull())
    shadow.querySelector<HTMLButtonElement>('.mtb-clarify-skip')!.click()
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-success')).not.toBeNull())
    expect(bodies[bodies.length - 1]!.get('feedback[screenshot]')).toBeNull()

    shadow.querySelector<HTMLButtonElement>('.mtb-close-link')!.click()

    // Second report: the box must be ticked again, and mean it.
    openCardWithPin(shadow)
    const second = shadow.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
    expect(second.checked).toBe(true)

    typeAndSubmit(shadow, 'second report')
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(1))
    await vi.waitFor(() => {
      expect(bodies[bodies.length - 1]!.get('feedback[screenshot]')).toBeInstanceOf(File)
    })
  })

  it('rasterizes the page during a typing pause, not at submit', async () => {
    const { toJpeg } = await import('html-to-image')
    const toJpegMock = vi.mocked(toJpeg)
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))

    const target = document.createElement('button')
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    // Drain captures still resolving from earlier tests' popups so the counts
    // below only measure this flow.
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    toJpegMock.mockClear()

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    openCardWithPin(shadow)
    const countBeforeTyping = toJpegMock.mock.calls.length

    const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
    textarea.value = 'Export is'
    textarea.dispatchEvent(new Event('input'))

    // Typing keeps pushing the capture back: rasterizing blocks the main
    // thread hard enough to stutter the keystrokes it would run under.
    await new Promise(resolve => setTimeout(resolve, 500))
    textarea.value = 'Export is broken'
    textarea.dispatchEvent(new Event('input'))
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(toJpegMock.mock.calls.length).toBe(countBeforeTyping)

    // A pause long enough to re-read is when the page gets rasterized, so
    // submit only pays for the annotation bake.
    await vi.waitFor(() => expect(toJpegMock.mock.calls.length).toBe(countBeforeTyping + 1), { timeout: 3000 })
    const capturedBeforeSubmit = toJpegMock.mock.calls.length

    shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify')).not.toBeNull())

    expect(toJpegMock.mock.calls.length).toBe(capturedBeforeSubmit)
  })

  // The desktop draw bar is a note surface too: the typing window starts the
  // moment it opens, and paying for a page rasterization at submit there
  // — while the pin and touch flows had already captured — was a silent
  // regression on exactly the flow with the most pixels to bake.
  it('rasterizes the page while the desktop draw bar is open, not at submit', async () => {
    const { toJpeg } = await import('html-to-image')
    const toJpegMock = vi.mocked(toJpeg)
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))

    const target = document.createElement('button')
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    // Drain captures still resolving from earlier tests' popups so the counts
    // below only measure this flow.
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
    toJpegMock.mockClear()

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull())

    // Typing into the bar's note field pushes the capture back the same way
    // the popup's textarea does.
    const noteInput = shadow.querySelector<HTMLInputElement>('.mtb-draw-input')!
    noteInput.value = 'Chart is'
    noteInput.dispatchEvent(new Event('input'))
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(toJpegMock.mock.calls.length).toBe(0)

    // The capture belongs to the typing window: it fires during the pause, so
    // submit only pays for the annotation bake.
    await vi.waitFor(() => expect(toJpegMock.mock.calls.length).toBe(1), { timeout: 3000 })
    const capturedBeforeSubmit = toJpegMock.mock.calls.length

    shadow.querySelector<HTMLButtonElement>('.mtb-draw-submit')!.click()
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify')).not.toBeNull())

    expect(toJpegMock.mock.calls.length).toBe(capturedBeforeSubmit)
  })

  // The draw bar's Enter keydown used to not travel to the clarify card:
  // handleDrawSubmit didn't forward it, so the card's window-level Enter
  // listener saw it as "a new Enter" and immediately skip()d the follow-up
  // question. This test covers the full chain: draw-bar Enter → controller →
  // clarify card identity-ignores it → clarify card survives → a second Enter
  // then correctly skips.
  it('does not skip the clarify question when the draw bar submits via Enter', async () => {
    const target = document.createElement('button')
    target.textContent = 'Export PDF'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/feedback')) {
        return new Response(JSON.stringify({
          feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
        }), { status: 201 })
      }
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[{"role":"assistant","content":"What happened?"}],"done":false}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (init?.body instanceof FormData) {
        return new Response(JSON.stringify({
          submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
        }), { status: 201 })
      }
      return new Response('{}', { status: 200 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull())

    const noteInput = shadow.querySelector<HTMLInputElement>('.mtb-draw-input')!
    noteInput.value = 'the chart is wrong'
    noteInput.dispatchEvent(new Event('input'))

    // Submit via Enter — the exact path that was broken.
    noteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    // The clarify card must appear and STAY — the Enter that submitted the
    // drawing must not also skip the follow-up question.
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify')).not.toBeNull(), { timeout: 5000 })
    // Give any queued skip a chance to fire — if the keydown leaked, the
    // clarify card would be destroyed within one tick.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(shadow.querySelector('.mtb-clarify')).not.toBeNull()

    // A *second* Enter should skip the clarify (that is the intentional UX).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-clarify')).toBeNull(), { timeout: 2000 })
  })

  // The collectors patch window.onerror and history before the shadow
  // container exists. When the page supplies a host element that refuses
  // attachShadow, that failure must roll the patches back and stay out of the
  // customer's script — a widget that cannot start is a no-op, not a crash.
  it('rolls back patched globals when the supplied host cannot take a shadow root', () => {
    const nativePush = history.pushState
    const originalOnError = window.onerror
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provided = document.createElement('a')
    provided.id = 'mtb-widget-host'
    document.body.appendChild(provided)
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    expect(() => MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })).not.toThrow()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to start'), expect.anything())
    expect(history.pushState).toBe(nativePush)
    expect(window.onerror).toBe(originalOnError)
    // The keydown handler is only ever attached after a successful buildUI, and
    // every document listener the collectors added must have been released.
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0)
    const addedBreadcrumbListeners = addSpy.mock.calls.filter(([type]) => type === 'click' || type === 'change').length
    const removedBreadcrumbListeners = removeSpy.mock.calls.filter(([type]) => type === 'click' || type === 'change').length
    expect(addedBreadcrumbListeners).toBeGreaterThan(0)
    expect(removedBreadcrumbListeners).toBe(addedBreadcrumbListeners)

    // The inert instance must still take every public call without reaching
    // for the shadow container that never came to exist.
    expect(() => {
      MakeThisBetter.open()
      MakeThisBetter.showLauncher()
      MakeThisBetter.destroy()
    }).not.toThrow()
  })

  it('reports a background finalize failure the dismissed card can no longer show', async () => {
    let finalizeAttempts = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url)
      if (href.endsWith('/feedback')) {
        finalizeAttempts += 1
        if (finalizeAttempts === 1) return new Response('{}', { status: 422 })
        return new Response(JSON.stringify({
          feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
        }), { status: 201 })
      }
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: true },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    await submitDescriptionAndSkipClarification(shadow)

    // The clarification card owns the inline retry footer and it is gone, so a
    // silent throw here is a submission the reporter believes was delivered.
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-failure')).not.toBeNull(), { timeout: 3000 })
    expect(shadow.querySelector('.mtb-failure-title')?.textContent).toBe('Failed to submit. Please try again.')

    shadow.querySelector<HTMLButtonElement>('.mtb-failure-retry')!.click()

    await vi.waitFor(() => expect(shadow.querySelector('.mtb-success')).not.toBeNull(), { timeout: 3000 })
    expect(shadow.querySelector('.mtb-failure')).toBeNull()
  })

  it('offers no retry when the submission session itself never existed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url)
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      return new Response('{}', { status: 422 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    await submitDescriptionAndSkipClarification(shadow)

    await vi.waitFor(() => expect(shadow.querySelector('.mtb-failure')).not.toBeNull(), { timeout: 3000 })
    // Retrying a finalize with no session on the server can only fail the same
    // way, so the card offers the only useful action.
    expect(shadow.querySelector('.mtb-failure-retry')).toBeNull()
    expect(shadow.querySelector('.mtb-failure-close')).not.toBeNull()

    // A stalled submission used to leave the launcher inert with nothing on
    // screen; whatever the card reports, annotating has to work again.
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
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
    openCardTypeAndSubmit(shadow)

    // The clarify card paints before the Session exists, so waiting on the card
    // alone would exit while the capture is still running — a case the pre-POST
    // guard now covers, and one with no Session left to abandon. The first
    // clarification request is the point where the Session is on record.
    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/clarification'))).toBe(true)
    })
    tab.click()

    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    })
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(false)
  })

  // The clarify card's header X is the reporter's "don't send at all" exit: it
  // must reuse the exitAll seam — abandon the uploaded Session, never
  // finalize, and hand the widget back in an idle, reopenable state.
  it('abandons the Session when the clarify header X cancels mid-conversation', async () => {
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
    openCardTypeAndSubmit(shadow)

    // Wait for the live conversation: the Session is on record and the
    // assistant question is on screen.
    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/clarification'))).toBe(true)
    })
    shadow.querySelector<HTMLButtonElement>('.mtb-clarify-close')!.click()

    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    })
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(false)
    expect(shadow.querySelector('.mtb-clarify')).toBeNull()
    expect(shadow.querySelector('.mtb-success')).toBeNull()

    // Cancelling must leave the launcher usable again.
    shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
    expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
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
    openCardTypeAndSubmit(shadow)

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

  it('never creates the Session when Exit lands while the screenshot is still capturing', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    const { toJpeg } = await import('html-to-image')
    let finishCapture!: () => void
    vi.mocked(toJpeg).mockImplementationOnce(() => new Promise<string>((resolve) => {
      finishCapture = () => resolve('data:image/jpeg;base64,/9j/AA==')
    }))

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request: ${String(url)}`)
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    const tab = shadow.querySelector<HTMLButtonElement>('.mtb-tab')!
    openCardTypeAndSubmit(shadow)

    await vi.waitFor(() => {
      expect(vi.mocked(toJpeg)).toHaveBeenCalled()
    })
    tab.click()
    // The reporter is gone, but the capture they started still lands. Nothing it
    // produced — screenshot, page context, breadcrumbs — may leave the browser.
    finishCapture()
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback_submission_sessions'))).toBe(false)
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
    openCardTypeAndSubmit(shadow)

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
    openCardTypeAndSubmit(shadow, 'Anonymous feedback')

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
    openCardTypeAndSubmit(shadow, 'Anonymous feedback')
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
    openCardTypeAndSubmit(shadow, 'Anonymous feedback')
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
    openCardTypeAndSubmit(shadow, 'Anonymous feedback')
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
    openCardTypeAndSubmit(shadow, 'Second feedback')
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
    openCardWithPin(shadow)

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
    openCardWithPin(shadow)

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
    openCardWithPin(shadow)

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
    openCardTypeAndSubmit(shadow, 'Host feedback')

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
    openCardTypeAndSubmit(shadow, 'Anonymous again')

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
    openCardTypeAndSubmit(shadow, 'Host feedback')
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

  // userTokenFn is host code, and the View feedback click awaits it. A token
  // backend outage there is the customer's failure to have, not an unhandled
  // rejection for the widget to hand their page from a handler they never wrote.
  it('keeps a rejecting userTokenFn from surfacing on the host page', async () => {
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

    // The token has to resolve while the submission is in flight — every API
    // call sends it — and only start failing at the click under test.
    let tokenBackendDown = false
    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
      user: { id: 'user_1' },
      userTokenFn: async () => {
        if (tokenBackendDown) throw new Error('token backend down')
        return 'host.signed.jwt'
      },
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    openCardTypeAndSubmit(shadow, 'Host feedback')
    await confirmSubmission(shadow)

    await vi.waitFor(() => {
      expect(shadow.querySelector('.mtb-view-feedback-link')).not.toBeNull()
    }, { timeout: 5000 })

    tokenBackendDown = true
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const unhandled = vi.fn()
    const proc = (globalThis as {
      process?: {
        on(event: string, listener: (reason: unknown) => void): void
        off(event: string, listener: (reason: unknown) => void): void
      }
    }).process
    proc?.on('unhandledRejection', unhandled)

    shadow.querySelector<HTMLButtonElement>('.mtb-view-feedback-link')!.click()
    // Unhandled rejections surface on later macrotasks, so give them the room
    // this assertion is about denying them.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    proc?.off('unhandledRejection', unhandled)

    expect(openSpy).not.toHaveBeenCalled()
    expect(unhandled).not.toHaveBeenCalled()
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
    openCardTypeAndSubmit(shadow)

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

  // To the reporter a recorded submission is ONE thing — the recording, which
  // naturally contains the page image. The note popup after a recording must
  // therefore disclose the recording alone, locked, and ask no screenshot
  // question — even when the reporter declined the screenshot in a pin popup
  // moments earlier: the recording overrides that, and the payload must carry
  // both artifacts.
  it('discloses only the locked recording after a recording, and sends both artifacts', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    const bodies: FormData[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/feedback')) {
        return new Response(JSON.stringify({
          feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
        }), { status: 201 })
      }
      if (href.endsWith('/clarification')) {
        return new Response(
          'event: done\ndata: {"messages":[{"role":"assistant","content":"All clear!"}],"done":true}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      }
      if (init?.body instanceof FormData) bodies.push(init.body)
      return new Response(JSON.stringify({
        submission_session: { id: 'submission_1', token: 'secret', ai_clarify_available: false },
      }), { status: 201 })
    })

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

    // Decline the screenshot in a pin popup, then move to Record from there.
    openCardWithPin(shadow)
    const pinBox = shadow.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
    expect(pinBox.disabled).toBe(false)
    pinBox.checked = false
    pinBox.dispatchEvent(new Event('change'))
    shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()

    await vi.waitFor(() => expect(shadow.querySelector('.mtb-record-stop')).not.toBeNull())
    // The control bar mounts before the (dynamically imported) recorder is
    // attached; stopping in that gap yields an empty recording. Let the
    // import's microtasks flush so the mock recorder emits its snapshot.
    await new Promise(resolve => setTimeout(resolve, 0))
    shadow.querySelector<HTMLButtonElement>('.mtb-record-stop')!.click()
    await vi.waitFor(() => expect(shadow.querySelector('.mtb-popup')).not.toBeNull())

    // One locked row naming the recording; no live screenshot choice anywhere.
    const rows = shadow.querySelectorAll('.mtb-screenshot-opt')
    expect(rows.length).toBe(1)
    const row = rows[0]!
    expect(row.classList.contains('mtb-screenshot-opt--locked')).toBe(true)
    expect(row.textContent).toContain(getMessages('en').popup.recording_label)
    const box = row.querySelector<HTMLInputElement>('input')!
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)

    typeAndSubmit(shadow, 'watch what happens after the export click')

    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    const formData = bodies[bodies.length - 1]!
    await vi.waitFor(() => {
      expect(formData.get('feedback[screenshot]')).toBeInstanceOf(File)
    })
    expect(formData.get('feedback[recording]')).not.toBeNull()
  })

  it('never leaves an orphaned dim scrim when a pin popup is followed by a recording popup', async () => {
    const target = document.createElement('button')
    target.id = 'export-btn'
    target.textContent = 'Export PDF'
    document.body.appendChild(target)
    document.elementsFromPoint = vi.fn(() => [target])

    MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

    // Open a pin popup — this creates the first dim scrim.
    openCardWithPin(shadow)
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

    // Dismissing the widget clears every scrim, keeping the host page
    // interactive. The clock is pushed past the scrim's spawn grace first —
    // inside it, a click is assumed to be the touch-compat replay of the tap
    // that created the scrim, not a deliberate dismissal.
    const realNow = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 1_000)
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
    openCardTypeAndSubmit(shadow)

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

  // Every init() before the document is ready used to queue its own
  // DOMContentLoaded listener. Two of them mounted two controllers, and only
  // the last was reachable through the module — the first kept its document
  // listeners and its detectors running with nothing able to stop them.
  describe('init() called before the document is ready', () => {
    function setLoading(loading: boolean): void {
      Object.defineProperty(document, 'readyState', {
        value: loading ? 'loading' : 'complete',
        configurable: true,
      })
    }

    afterEach(() => { setLoading(false) })

    function spyOnDocumentListeners() {
      return vi.spyOn(document, 'addEventListener')
    }

    function countDocumentKeydownListeners(): number {
      return addSpy.mock.calls.filter(([type]) => type === 'keydown').length
    }

    let addSpy: ReturnType<typeof spyOnDocumentListeners>

    beforeEach(() => {
      setLoading(true)
      addSpy = spyOnDocumentListeners()
    })

    it('mounts one controller no matter how many times it is called', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      document.dispatchEvent(new Event('DOMContentLoaded'))

      expect(countDocumentKeydownListeners()).toBe(1)
    })

    it('replaces the controller when called repeatedly after the document is ready', () => {
      setLoading(false)
      const removeSpy = vi.spyOn(document, 'removeEventListener')

      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

      const removedKeydownListeners = removeSpy.mock.calls.filter(([type]) => type === 'keydown').length
      expect(document.querySelectorAll('#mtb-widget-host')).toHaveLength(1)
      expect(countDocumentKeydownListeners() - removedKeydownListeners).toBe(1)
    })

    it('does not mount at all if destroyed before the document loads', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      MakeThisBetter.destroy()
      document.dispatchEvent(new Event('DOMContentLoaded'))

      expect(document.getElementById('mtb-widget-host')).toBeNull()
      expect(countDocumentKeydownListeners()).toBe(0)
    })

    it('keeps one controller when Turbo loads before the document is ready', () => {
      // turbo:load mounts eagerly, so it must also take the queued
      // DOMContentLoaded mount with it — otherwise that deferred callback
      // installs a second controller and orphans the first one's listeners.
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })

      document.dispatchEvent(new Event('turbo:load'))
      document.dispatchEvent(new Event('DOMContentLoaded'))

      expect(document.querySelectorAll('#mtb-widget-host')).toHaveLength(1)
      const removedKeydownListeners = removeSpy.mock.calls.filter(([type]) => type === 'keydown').length
      expect(countDocumentKeydownListeners() - removedKeydownListeners).toBe(1)
    })
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

    // Escape is how you back out of a wrong IME candidate. Acting on it there
    // costs a reporter typing Chinese or Japanese the popup and every word in
    // it, for pressing the key their input method told them to press.
    it('leaves an IME composition alone', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      } as KeyboardEventInit))

      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
    })

    it('leaves a legacy IME boundary event alone', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(event, 'keyCode', { value: 229 })
      document.dispatchEvent(event)

      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
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
      openCardWithPin(shadow)
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
      openCardTypeAndSubmit(shadow)

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

  describe('draw note surface', () => {
    // The draw note bar is a desktop affordance: a pill with an inline field,
    // small icon buttons and a submit, all crammed into one row at the bottom
    // of the screen — which on a phone is where the keyboard lands. Touch gets
    // the same bottom sheet the pin flow already uses.
    it('collects the note in the sheet, not the inline bar, on touch', async () => {
      setPointerCoarse(true)
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      MakeThisBetter.open()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-popup')).not.toBeNull()
      })
      expect(shadow.querySelector('.mtb-draw-bar')).toBeNull()
    })

    it('keeps the inline bar for a mouse', async () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull()
      })
      expect(shadow.querySelector('.mtb-popup')).toBeNull()
    })

    it('submits the drawing with the note typed into the sheet', async () => {
      setPointerCoarse(true)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
        sessionFlowResponse(url, init, { id: 'FB-9', status: 'received', project_id: 'acme' }))

      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      MakeThisBetter.open()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

      await vi.waitFor(() => expect(shadow.querySelector('.mtb-popup')).not.toBeNull())
      const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
      textarea.value = 'this row is misaligned'
      textarea.dispatchEvent(new Event('input'))
      shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()

      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.some(([, i]) => (i?.body as FormData)?.get('feedback[description]') === 'this row is misaligned')).toBe(true)
      })
    })

    it('cancelling the sheet returns to markup instead of closing the widget', async () => {
      setPointerCoarse(true)
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
      MakeThisBetter.open()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)

      await vi.waitFor(() => expect(shadow.querySelector('.mtb-popup')).not.toBeNull())
      shadow.querySelector<HTMLButtonElement>('.mtb-cancel-btn')!.click()

      expect(shadow.querySelector('.mtb-popup')).toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
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

    it('applies the new locale to the next popup that opens', async () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!

      MakeThisBetter.setLocale('zh-CN')
      ;(shadow.querySelector('.mtb-tab') as HTMLElement).click()
      await Promise.resolve()
      ;(document.body.querySelector('main') as HTMLElement | null)?.click()
      await Promise.resolve()

      expect(shadow.textContent).not.toContain('Feedback')
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

    it('re-mounts when Turbo restores a cached host without its shadow root', () => {
      MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
      document.getElementById('mtb-widget-host')!.remove()
      const cachedHost = document.createElement('div')
      cachedHost.id = 'mtb-widget-host'
      document.body.appendChild(cachedHost)

      document.dispatchEvent(new Event('turbo:load'))

      const restoredHost = document.getElementById('mtb-widget-host')!
      expect(restoredHost).not.toBe(cachedHost)
      expect(restoredHost.shadowRoot).not.toBeNull()
      expect(document.querySelectorAll('#mtb-widget-host')).toHaveLength(1)
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

  describe('frustration prompt', () => {
    function initWidget(): ShadowRoot {
      MakeThisBetter.init({
        projectKey: 'acme',
        apiUrl: 'https://api.example.com/api/v1',
        frustrationDetection: true,
      })
      return document.getElementById('mtb-widget-host')!.shadowRoot!
    }

    function rageClick(): void {
      const div = document.createElement('div')
      div.textContent = 'static text'
      document.body.appendChild(div)
      for (let i = 0; i < 4; i++) div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      document.body.removeChild(div)
    }

    // Lets the next signal through without waiting out the detector's 60s
    // throttle, leaving the dismissal flag exactly as the widget left it.
    function clearCooldownOnly(): void {
      saveFrustrationState({ ...loadFrustrationState(), cooldownUntil: 0, navTimestamps: [] })
    }

    beforeEach(() => {
      vi.useFakeTimers()
      clearFrustrationState()
    })

    afterEach(() => {
      vi.useRealTimers()
      clearFrustrationState()
    })

    it('shows the prompt on a frustration signal', () => {
      const shadow = initWidget()

      rageClick()

      expect(shadow.querySelector('.mtb-frustration-prompt')).not.toBeNull()
    })

    // Nobody looked at the card. That is not a decision, so it must not be
    // recorded as one — the flag is what suppresses every later prompt.
    it('treats the 8s auto-hide as no decision at all', () => {
      const shadow = initWidget()
      rageClick()

      vi.advanceTimersByTime(8000)

      expect(shadow.querySelector('.mtb-frustration-prompt')).toBeNull()
      expect(isFrustrationDismissed()).toBe(false)

      clearCooldownOnly()
      rageClick()
      expect(shadow.querySelector('.mtb-frustration-prompt')).not.toBeNull()
    })

    it('suppresses later prompts only after a real Dismiss click', () => {
      const shadow = initWidget()
      rageClick()

      shadow.querySelector<HTMLButtonElement>('.mtb-frustration-dismiss')!.click()

      expect(shadow.querySelector('.mtb-frustration-prompt')).toBeNull()
      expect(isFrustrationDismissed()).toBe(true)

      clearCooldownOnly()
      rageClick()
      expect(shadow.querySelector('.mtb-frustration-prompt')).toBeNull()
    })

    // Engaging destroyed the card but left its timer running, so 8s later the
    // stale auto-hide fired onDismiss and disabled prompting for the session.
    it('does not record a refusal when the reporter engages via Tell us', () => {
      const shadow = initWidget()
      rageClick()

      shadow.querySelector<HTMLButtonElement>('.mtb-frustration-tell')!.click()
      expect(shadow.querySelector('.mtb-frustration-prompt')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()

      vi.advanceTimersByTime(30_000)

      expect(isFrustrationDismissed()).toBe(false)
    })

    it('remembers a dismissal across a Turbo navigation', () => {
      const shadow = initWidget()
      rageClick()
      shadow.querySelector<HTMLButtonElement>('.mtb-frustration-dismiss')!.click()
      expect(isFrustrationDismissed()).toBe(true)

      // Turbo replaces the body; index.ts rebuilds the controller from scratch.
      MakeThisBetter.destroy()
      const rebuilt = initWidget()
      clearCooldownOnly()
      rageClick()

      expect(rebuilt.querySelector('.mtb-frustration-prompt')).toBeNull()
    })
  })

  // Both the breadcrumb collector and the frustration detector need history
  // navigation events. They used to wrap history.pushState individually, and
  // teardown could only unwrap the outermost one — so every Turbo Drive visit
  // (which destroys and rebuilds the controller) left the host page's pushState
  // one dead closure deeper, each retaining a dead collector.
  describe('history patching', () => {
    it('leaves history.pushState untouched after destroy with both collectors installed', () => {
      const nativePush = history.pushState
      const nativeReplace = history.replaceState

      MakeThisBetter.init({
        projectKey: 'acme',
        apiUrl: 'https://api.example.com/api/v1',
        frustrationDetection: true,
      })
      expect(history.pushState).not.toBe(nativePush)

      MakeThisBetter.destroy()

      expect(history.pushState).toBe(nativePush)
      expect(history.replaceState).toBe(nativeReplace)
    })

    it('does not accumulate wrappers across repeated init/destroy cycles', () => {
      const nativePush = history.pushState
      const nativeReplace = history.replaceState

      for (let i = 0; i < 50; i++) {
        MakeThisBetter.init({
          projectKey: 'acme',
          apiUrl: 'https://api.example.com/api/v1',
          frustrationDetection: true,
        })
        MakeThisBetter.destroy()
      }

      expect(history.pushState).toBe(nativePush)
      expect(history.replaceState).toBe(nativeReplace)
    })

    it('restores history.pushState when frustration detection is disabled', () => {
      const nativePush = history.pushState

      MakeThisBetter.init({
        projectKey: 'acme',
        apiUrl: 'https://api.example.com/api/v1',
        frustrationDetection: false,
      })
      MakeThisBetter.destroy()

      expect(history.pushState).toBe(nativePush)
    })
  })
})
