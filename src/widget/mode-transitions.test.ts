// Characterization net for the controller's mode machine (the State-pattern refactor
// prep). Every test observes only the public surface — MakeThisBetter API,
// DOM inside the shadow root, mocked network — so the State-pattern rewrite
// can rename every internal and still be judged by this file staying green
// with zero assertion changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MakeThisBetter } from '../index'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
  getFontEmbedCSS: vi.fn(async () => ''),
}))

vi.mock('@rrweb/record', () => {
  const record = Object.assign(() => () => {}, { addCustomEvent: () => {} })
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

// One happy-path server: session created, clarification comes back with
// nothing to ask, finalize succeeds, abandon accepted.
function happyPathResponse(url: RequestInfo | URL, init: RequestInit | undefined): Response {
  const href = String(url)
  if (init?.method === 'DELETE') return new Response(null, { status: 204 })
  if (href.endsWith('/feedback')) {
    return new Response(JSON.stringify({
      feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
    }), { status: 201 })
  }
  if (href.endsWith('/clarification')) {
    return new Response(
      'event: done\ndata: {"messages":[],"done":true,"suggestions":[]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  return new Response(JSON.stringify({
    submission_session: { id: 'submission_1', token: 'submission-secret', ai_clarify_available: true },
  }), { status: 201 })
}

// A clarification that stays open (done: false), keeping the card mounted so
// the clarifying mode itself can be observed.
function openConversationResponse(url: RequestInfo | URL, init: RequestInit | undefined): Response {
  const href = String(url)
  if (init?.method === 'DELETE') return new Response(null, { status: 204 })
  if (href.endsWith('/feedback')) {
    return new Response(JSON.stringify({
      feedback: { id: 'FB-1', status: 'received', project_id: 'acme' },
    }), { status: 201 })
  }
  if (href.endsWith('/clarification')) {
    return new Response(
      'event: done\ndata: {"messages":[{"role":"assistant","content":"What broke?"}],"done":false,"suggestions":[]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  return new Response(JSON.stringify({
    submission_session: { id: 'submission_1', token: 'submission-secret', ai_clarify_available: true },
  }), { status: 201 })
}

function initWidget(): ShadowRoot {
  MakeThisBetter.init({ projectKey: 'acme', apiUrl: 'https://api.example.com/api/v1' })
  return document.getElementById('mtb-widget-host')!.shadowRoot!
}

function openCardWithPin(shadow: ShadowRoot): void {
  shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
  placePin(shadow)
}

function placePin(shadow: ShadowRoot): void {
  const overlay = shadow.querySelector<HTMLDivElement>('.mtb-overlay')!
  overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 30, bubbles: true }))
  overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 30, bubbles: true }))
}

// The pin and record flows collect the note in the chat card; the touch draw
// flow still uses the comment sheet. Both are "the note surface that is up".
function typeAndSubmit(shadow: ShadowRoot, description = 'Export is broken'): void {
  const chatInput = shadow.querySelector<HTMLTextAreaElement>('.mtb-chat-input')
  if (chatInput) {
    chatInput.value = description
    chatInput.dispatchEvent(new Event('input'))
    shadow.querySelector<HTMLButtonElement>('.mtb-chat-send')!.click()
    return
  }
  const textarea = shadow.querySelector<HTMLTextAreaElement>('.mtb-textarea')!
  textarea.value = description
  textarea.dispatchEvent(new Event('input'))
  shadow.querySelector<HTMLButtonElement>('.mtb-submit-btn')!.click()
}

function performDrawStroke(overlay: HTMLDivElement): void {
  overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, composed: true }))
  for (let i = 1; i <= 5; i++) {
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 10 + i * 8, clientY: 10 + i * 8, bubbles: true }))
  }
  overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }))
}

/** Dispatches a cancelable Escape and reports whether the widget consumed it. */
function pressEscape(): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  return event.defaultPrevented
}

/** Runs the full submit -> nothing to ask -> success terminal flow. */
async function submitToSuccess(shadow: ShadowRoot): Promise<void> {
  openCardWithPin(shadow)
  typeAndSubmit(shadow)
  await vi.waitFor(() => {
    expect(shadow.querySelector('.mtb-chat-success')).not.toBeNull()
  }, { timeout: 5000 })
}

describe('the mode machine', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', ImmediatelyLoadingImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(screenshotCanvasContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => happyPathResponse(url, init))
  })

  afterEach(() => {
    MakeThisBetter.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    document.body.removeAttribute('style')
  })

  describe('entering annotation', () => {
    it('open() turns idle into an annotation session: toolbar, drawing surface, lit launcher', () => {
      const shadow = initWidget()

      MakeThisBetter.open()

      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
      // The launcher stays on screen and lights up rather than hiding.
      const tab = shadow.querySelector('.mtb-tab')!
      expect(tab.classList.contains('active')).toBe(true)
    })

    it('a second open() while already annotating changes nothing', () => {
      const shadow = initWidget()
      MakeThisBetter.open()
      const overlayBefore = shadow.querySelector('.mtb-overlay')

      MakeThisBetter.open()

      expect(shadow.querySelectorAll('.mtb-toolbar')).toHaveLength(1)
      // Same session, not a rebuilt one: the surface element is untouched.
      expect(shadow.querySelector('.mtb-overlay')).toBe(overlayBefore)
    })
  })

  describe('switching tools on the toolbar', () => {
    it('markup -> record clears the annotation surfaces and starts the recorder', async () => {
      const shadow = initWidget()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)
      expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull()

      shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()

      // Recording captures the user reproducing something; the pin and draw
      // surfaces would sit on top of the page, so they come down first.
      expect(shadow.querySelector('.mtb-draw-bar')).toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).toBeNull()
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-record-bar')).not.toBeNull()
      })
    })

    // CHARACTERIZED SURPRISE: the drawing made before the switch is discarded
    // by the switch itself — coming back to markup starts an empty session,
    // with no way back to the stroke. Pinned as today's behavior; the refactor
    // should decide whether that loss is deliberate.
    it('record -> markup starts a fresh empty surface; the earlier drawing is gone', async () => {
      const shadow = initWidget()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)
      shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-record-bar')).not.toBeNull()
      })

      shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-markup')!.click()

      expect(shadow.querySelector('.mtb-record-bar')).toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
      // The draw bar does not come back: the stroke did not survive the trip.
      expect(shadow.querySelector('.mtb-draw-bar')).toBeNull()
    })
  })

  describe('Escape per mode', () => {
    it('falls through untouched while idle so the host page keeps its own Escape', () => {
      const shadow = initWidget()

      const consumed = pressEscape()

      expect(consumed).toBe(false)
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
    })

    it('exits annotation mode all the way back to idle', () => {
      const shadow = initWidget()
      MakeThisBetter.open()

      const consumed = pressEscape()

      expect(consumed).toBe(true)
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.querySelector('.mtb-tab')!.classList.contains('active')).toBe(false)
    })

    it('cancels a drawing back to annotating, not all the way out', () => {
      const shadow = initWidget()
      MakeThisBetter.open()
      performDrawStroke(shadow.querySelector<HTMLDivElement>('.mtb-overlay')!)
      expect(shadow.querySelector('.mtb-draw-bar')).not.toBeNull()

      const consumed = pressEscape()

      expect(consumed).toBe(true)
      // One Escape costs the stroke, not the session: still annotating.
      expect(shadow.querySelector('.mtb-draw-bar')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).not.toBeNull()
    })

    // CHARACTERIZED SURPRISE: Escape while recording is not a cancel — it is
    // the stop button. The recording is kept and the note popup opens, exactly
    // as if the reporter had pressed Stop.
    it('stops a recording and opens the note popup rather than cancelling it', async () => {
      const shadow = initWidget()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!.click()
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-record-bar')).not.toBeNull()
      })

      const consumed = pressEscape()

      expect(consumed).toBe(true)
      expect(shadow.querySelector('.mtb-record-bar')).toBeNull()
      expect(shadow.querySelector('.mtb-chat')).not.toBeNull()
    })

    // Clarifying used to be the one active mode Escape did not touch. It now
    // exits like the rest: the card owns its own Escape and routes it to the
    // same cancel its X does, so an unanswered question costs one key.
    it('closes the clarify conversation', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => openConversationResponse(url, init))
      const shadow = initWidget()
      openCardWithPin(shadow)
      typeAndSubmit(shadow)
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-chat-bubble-ai')).not.toBeNull()
      }, { timeout: 5000 })

      const consumed = pressEscape()

      expect(consumed).toBe(true)
      expect(shadow.querySelector('.mtb-chat')).toBeNull()
    })
  })

  describe('cancel paths land in idle with no orphaned document listeners', () => {
    const spyOnAdd = () => vi.spyOn(document, 'addEventListener')
    const spyOnRemove = () => vi.spyOn(document, 'removeEventListener')
    let addSpy: ReturnType<typeof spyOnAdd>
    let removeSpy: ReturnType<typeof spyOnRemove>

    // Counts listeners actually live on the document, the way the document
    // itself does: an add is live until a remove with the same type, function,
    // and capture phase lands; a remove that never matched an add is a no-op
    // (the toolbar removes a touch-hint listener it only adds on touch).
    function liveDocumentListeners(): number {
      const capture = (options: unknown): boolean =>
        options === true || (typeof options === 'object' && options !== null && (options as AddEventListenerOptions).capture === true)
      const live: { type: string; fn: unknown; cap: boolean }[] = []
      for (const [type, fn, options] of addSpy.mock.calls) {
        live.push({ type: String(type), fn, cap: capture(options) })
      }
      for (const [type, fn, options] of removeSpy.mock.calls) {
        const cap = capture(options)
        const index = live.findIndex((entry) => entry.type === String(type) && entry.fn === fn && entry.cap === cap)
        if (index !== -1) live.splice(index, 1)
      }
      return live.length
    }

    beforeEach(() => {
      addSpy = spyOnAdd()
      removeSpy = spyOnRemove()
    })

    it('a tap on the dim scrim', async () => {
      const shadow = initWidget()
      const idleBaseline = liveDocumentListeners()
      openCardWithPin(shadow)

      // Past the scrim's spawn grace: inside it a click is treated as the
      // touch-compat replay of the tap that created the scrim.
      const realNow = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 1_000)
      shadow.querySelector<HTMLDivElement>('.mtb-dim')!.click()

      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      expect(shadow.querySelector('.mtb-chat')).toBeNull()
      expect(shadow.querySelector('.mtb-dim')).toBeNull()
      expect(shadow.querySelector('.mtb-tab')!.classList.contains('active')).toBe(false)
      await vi.waitFor(() => expect(liveDocumentListeners()).toBe(idleBaseline))
    })

    it('the toolbar exit button', async () => {
      const shadow = initWidget()
      const idleBaseline = liveDocumentListeners()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()

      shadow.querySelector<HTMLButtonElement>('.mtb-exit-btn')!.click()

      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.querySelector('.mtb-tab')!.classList.contains('active')).toBe(false)
      await vi.waitFor(() => expect(liveDocumentListeners()).toBe(idleBaseline))
    })

    it('the clarify card X while the conversation is open', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => openConversationResponse(url, init))
      const shadow = initWidget()
      const idleBaseline = liveDocumentListeners()
      openCardWithPin(shadow)
      typeAndSubmit(shadow)
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-chat-bubble-ai')).not.toBeNull()
      }, { timeout: 5000 })

      shadow.querySelector<HTMLButtonElement>('.mtb-chat-close')!.click()

      expect(shadow.querySelector('.mtb-chat')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      expect(shadow.querySelector('.mtb-tab')!.classList.contains('active')).toBe(false)
      // The abandoned server session is told, and every listener the flow
      // added along the way has been released.
      await vi.waitFor(() => expect(liveDocumentListeners()).toBe(idleBaseline))
    })
  })

  describe('terminal flows', () => {
    it('submit -> nothing to ask -> success lands in idle with the toolbar gone', async () => {
      const shadow = initWidget()

      await submitToSuccess(shadow)

      expect(shadow.querySelector('.mtb-clarify')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      expect(shadow.querySelector('.mtb-tab')!.classList.contains('active')).toBe(false)
    })

    it('skipping the clarification finalizes in the background with an inert launcher', async () => {
      // Skip only exists while a question is still open — a clarification that
      // came back done shows the confirm footer instead.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => openConversationResponse(url, init))
      const shadow = initWidget()
      openCardWithPin(shadow)
      typeAndSubmit(shadow)
      await vi.waitFor(() => {
        expect(shadow.querySelector('.mtb-chat-skip')).not.toBeNull()
      }, { timeout: 5000 })

      shadow.querySelector<HTMLButtonElement>('.mtb-chat-skip')!.click()

      // Synchronously after skip the widget is in its background-submitting
      // state: the conversation and toolbar are down, and the launcher must not
      // start a second feedback on top of the one still finalizing.
      expect(shadow.querySelector('.mtb-chat-skip')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      expect(shadow.querySelector('.mtb-overlay')).toBeNull()
      expect(shadow.querySelector('.mtb-toolbar')).toBeNull()

      // The receipt is up right away — the finalize it kicked off is the part
      // that runs to completion in the background.
      expect(shadow.querySelector('.mtb-chat-success')).not.toBeNull()
      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/feedback'))).toBe(true)
      }, { timeout: 5000 })
    })
  })

  describe('inputs that must be ignored', () => {
    it('takes the drawing surface away while a pin note is being written', () => {
      const shadow = initWidget()

      openCardWithPin(shadow)

      // No stroke can land while the popup is up: the overlay itself is gone,
      // so a wandering pointer cannot start a second annotation underneath.
      expect(shadow.querySelector('.mtb-chat')).not.toBeNull()
      expect(shadow.querySelector('.mtb-overlay')).toBeNull()
    })

    it('keeps one recording when Record is pressed twice', async () => {
      const shadow = initWidget()
      shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
      const record = shadow.querySelector<HTMLButtonElement>('.mtb-toolbar-mode-record')!

      record.click()
      record.click()

      await vi.waitFor(() => {
        expect(shadow.querySelectorAll('.mtb-record-bar')).toHaveLength(1)
      })
    })
  })

  describe('re-entrancy', () => {
    it('a second session after a full submit-success cycle is fully functional', async () => {
      const shadow = initWidget()
      await submitToSuccess(shadow)

      // The receipt renders before the background finalize lands, and until it
      // lands the launcher deliberately refuses to start a second feedback —
      // so keep clicking until the widget has settled back to idle.
      await vi.waitFor(() => {
        shadow.querySelector<HTMLButtonElement>('.mtb-tab')!.click()
        expect(shadow.querySelector('.mtb-toolbar')).not.toBeNull()
      }, { timeout: 5000 })
      // The new session takes a pin and opens a working note popup — nothing
      // from the first cycle (destroyed session, consumed popup) leaks in.
      placePin(shadow)
      expect(shadow.querySelector('.mtb-chat')).not.toBeNull()
      expect(shadow.querySelector('.mtb-chat-input')).not.toBeNull()
    })
  })
})
