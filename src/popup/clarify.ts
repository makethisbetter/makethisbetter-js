import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { ApiClient } from '../api/client'
import type { ClarifyMessage } from '../types'
import { escapeHtml } from '../context/dom-utils'

const POLL_INTERVAL_MS = 2000
// Give up polling after this long with no assistant reply so the card never
// spins forever (e.g. a backend job that silently died).
const POLL_TIMEOUT_MS = 45000

export interface ClarifySummaryContext {
  originalDescription: string
  element: string
  page: string
  browser: string
  captured: string
}

interface ClarifyCardOptions {
  submissionSessionId: string
  submissionToken: string
  apiClient: ApiClient
  messages: I18nMessages
  onFinalize: () => Promise<void> | void
  summary?: ClarifySummaryContext
  x?: number
  y?: number
}

const CARD_WIDTH = 346
const CARD_HEIGHT = 320

export class ClarifyCard {
  private el: HTMLDivElement
  private messagesEl!: HTMLDivElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollDeadline = 0
  private streamingBubble: HTMLDivElement | null = null
  private submissionSessionId: string
  private submissionToken: string
  private apiClient: ApiClient
  private onFinalize: () => Promise<void> | void
  private i18n: I18nMessages
  private summaryCtx?: ClarifySummaryContext
  private lastMessages: ClarifyMessage[] = []
  private done = false
  private sending = false
  private finalizing = false
  private destroyed = false

  constructor(shadow: ShadowContainer, opts: ClarifyCardOptions) {
    this.submissionSessionId = opts.submissionSessionId
    this.submissionToken = opts.submissionToken
    this.apiClient = opts.apiClient
    this.onFinalize = opts.onFinalize
    this.i18n = opts.messages
    this.summaryCtx = opts.summary

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-clarify')
    this.el.innerHTML = this.buildHTML(opts.messages)
    this.positionCard(opts.x, opts.y)
    shadow.append(this.el)

    this.messagesEl = this.el.querySelector('.mtb-clarify-messages')!
    this.inputEl = this.el.querySelector('.mtb-clarify-input')!
    this.sendBtn = this.el.querySelector('.mtb-clarify-send')!

    this.bindEvents()
    this.startConversation()
  }

  // Anchors the card near the annotation point, clamped to the viewport so it
  // never overflows a screen edge (mirrors CommentPopup.positionPopup).
  private positionCard(x?: number, y?: number): void {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 12

    if (x === undefined || y === undefined) {
      this.el.style.left = `${Math.max(margin, (vw - CARD_WIDTH) / 2)}px`
      this.el.style.top = `${Math.max(margin, (vh - CARD_HEIGHT) / 2)}px`
      return
    }

    let left = x + 12
    let top = y + 12
    if (left + CARD_WIDTH > vw - margin) left = x - CARD_WIDTH - 12
    if (left < margin) left = margin
    if (top + CARD_HEIGHT > vh - margin) top = vh - CARD_HEIGHT - margin
    if (top < margin) top = margin

    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
  }

  private buildHTML(m: I18nMessages): string {
    return `
      <div class="mtb-clarify-header">
        <span class="mtb-clarify-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z"/>
          </svg>
        </span>
        <div class="mtb-clarify-titles">
          <div class="mtb-clarify-title">${escapeHtml(m.clarify.title)}</div>
          <div class="mtb-clarify-subtitle">${escapeHtml(m.clarify.subtitle)}</div>
        </div>
        <button class="mtb-clarify-close" type="button" title="${escapeHtml(m.clarify.skip)}" aria-label="${escapeHtml(m.clarify.skip)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="mtb-clarify-messages"></div>
      <div class="mtb-clarify-footer">
        <textarea class="mtb-clarify-input" rows="2" placeholder="${escapeHtml(m.clarify.placeholder)}"></textarea>
        <div class="mtb-clarify-actions">
          <button class="mtb-clarify-skip" type="button">${escapeHtml(m.clarify.skip)}</button>
          <button class="mtb-clarify-send" type="button" disabled>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            <span>${escapeHtml(m.clarify.send)}</span>
          </button>
        </div>
      </div>
    `
  }

  private bindEvents(): void {
    const skip = () => {
      this.stopPolling()
      void this.finalize()
    }
    this.el.querySelector('.mtb-clarify-skip')!.addEventListener('click', skip)
    this.el.querySelector('.mtb-clarify-close')!.addEventListener('click', skip)

    this.inputEl.addEventListener('input', () => {
      this.sendBtn.disabled = !this.inputEl.value.trim()
    })

    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.sendMessage()
      }
    })

    this.sendBtn.addEventListener('click', () => this.sendMessage())
  }

  private async startConversation(): Promise<void> {
    this.showThinking()
    await this.runInitialTurn()
  }

  private async sendMessage(): Promise<void> {
    const text = this.inputEl.value.trim()
    if (!text || this.sending) return

    this.sending = true
    this.inputEl.disabled = true
    this.sendBtn.disabled = true
    this.stopPolling()

    this.appendMessage({ role: 'user', content: text })
    this.inputEl.value = ''
    this.showThinking()
    this.clearError()

    try {
      await this.runAnswerTurn(text)
    } catch {
      if (this.destroyed) return
      this.renderConversation(this.lastMessages, false)
      this.inputEl.value = text
      this.showError()
    } finally {
      this.sending = false
      this.inputEl.disabled = false
      this.sendBtn.disabled = !this.inputEl.value.trim()
      this.inputEl.focus()
    }
  }

  // Streams the assistant reply; falls back to POST + polling if the backend
  // doesn't support SSE (older server) or the stream errors mid-flight.
  private async runInitialTurn(): Promise<void> {
    try {
      const result = await this.apiClient.streamClarification(
        this.submissionSessionId,
        this.submissionToken,
        (text) => this.appendStreamDelta(text),
      )
      if (this.destroyed) return
      this.endStreamingBubble()
      this.renderConversation(result.messages, result.done)
      if (result.done) this.handleDone()
      else this.startPolling()
    } catch {
      if (this.destroyed) return
      this.endStreamingBubble()
      await this.runInitialTurnViaPolling()
    }
  }

  private async runInitialTurnViaPolling(): Promise<void> {
    try {
      const res = await this.apiClient.startClarification(
        this.submissionSessionId,
        this.submissionToken,
      )
      if (this.destroyed) return
      this.renderConversation(res.messages, res.done)
      if (res.done) this.handleDone()
      else this.startPolling()
    } catch {
      if (this.destroyed) return
      this.handleDone()
    }
  }

  private async runAnswerTurn(message: string): Promise<void> {
    const res = await this.apiClient.startClarification(
      this.submissionSessionId,
      this.submissionToken,
      message,
    )
    if (this.destroyed) return
    this.renderConversation(res.messages, res.done)
    if (res.done) this.handleDone()
    else this.startPolling()
  }

  private showError(): void {
    const footer = this.el.querySelector('.mtb-clarify-footer')!
    const error = document.createElement('div')
    error.className = 'mtb-clarify-error'
    error.textContent = this.i18n.error.submit
    footer.prepend(error)
  }

  private clearError(): void {
    this.el.querySelector('.mtb-clarify-error')?.remove()
  }

  private appendStreamDelta(text: string): void {
    if (!this.streamingBubble) {
      this.removeThinking()
      this.streamingBubble = document.createElement('div')
      this.streamingBubble.className = 'mtb-clarify-bubble mtb-clarify-ai'
      this.messagesEl.appendChild(this.streamingBubble)
    }
    this.streamingBubble.textContent = (this.streamingBubble.textContent ?? '') + text
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private endStreamingBubble(): void {
    this.streamingBubble = null
  }

  private startPolling(): void {
    this.stopPolling()
    this.pollDeadline = Date.now() + POLL_TIMEOUT_MS
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async poll(): Promise<void> {
    if (Date.now() > this.pollDeadline) {
      this.stopPolling()
      this.handleDone()
      return
    }
    try {
      const res = await this.apiClient.getClarification(
        this.submissionSessionId,
        this.submissionToken,
      )
      if (this.destroyed) return
      this.renderConversation(res.messages, res.done)
      if (res.done) {
        this.stopPolling()
        this.handleDone()
      }
    } catch {
      if (this.destroyed) return
      this.stopPolling()
      this.handleDone()
    }
  }

  private handleDone(): void {
    if (this.done) return
    this.done = true
    this.stopPolling()
    this.removeThinking()
    this.renderSummary()
  }

  private renderSummary(): void {
    const s = this.i18n.clarify.summary
    const card = document.createElement('div')
    card.className = 'mtb-clarify-summary'
    card.innerHTML = this.buildSummaryHTML(s)
    this.messagesEl.appendChild(card)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight

    const footer = this.el.querySelector('.mtb-clarify-footer')!
    footer.innerHTML = `<button class="mtb-clarify-send-feedback" type="button">${escapeHtml(s.send_feedback)}</button>`
    footer.querySelector('.mtb-clarify-send-feedback')!.addEventListener('click', () => {
      if (!this.destroyed) void this.finalize()
    })
  }

  private async finalize(): Promise<void> {
    if (this.finalizing || this.destroyed) return

    this.finalizing = true
    this.el.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true })
    try {
      await this.onFinalize()
    } catch {
      if (this.destroyed) return
      this.finalizing = false
      this.handleDone()
      this.el.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false })
      this.clearError()
      this.showError()
    }
  }

  private buildSummaryHTML(s: I18nMessages['clarify']['summary']): string {
    const said = this.summaryCtx?.originalDescription?.trim()
    const saidBlock = said
      ? `<div class="mtb-summary-section">
          <div class="mtb-summary-label">${escapeHtml(s.what_you_said)}</div>
          <div class="mtb-summary-quote">${escapeHtml(said)}</div>
        </div>`
      : ''

    const pairs = this.clarifiedPairs()
    const clarifiedBlock = pairs.length
      ? `<div class="mtb-summary-section">
          <div class="mtb-summary-label">${escapeHtml(s.clarified)}</div>
          ${pairs.map(p => `<div class="mtb-summary-qa"><span class="mtb-summary-q">${escapeHtml(p.q)}</span><span class="mtb-summary-a">${escapeHtml(p.a)}</span></div>`).join('')}
        </div>`
      : ''

    return `
      <div class="mtb-summary-head">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>${escapeHtml(s.ready)}</span>
      </div>
      ${saidBlock}
      ${clarifiedBlock}
    `
  }

  private clarifiedPairs(): { q: string; a: string }[] {
    const pairs: { q: string; a: string }[] = []
    for (let i = 0; i < this.lastMessages.length - 1; i++) {
      const q = this.lastMessages[i]
      const a = this.lastMessages[i + 1]
      if (q.role !== 'user' && a.role === 'user') pairs.push({ q: q.content, a: a.content })
    }
    return pairs
  }

  private renderConversation(messages: ClarifyMessage[], done: boolean): void {
    this.lastMessages = messages
    this.renderMessages(messages)
    const last = messages[messages.length - 1]
    if (!done && (!last || last.role === 'user')) this.showThinking()
  }

  private renderMessages(messages: ClarifyMessage[]): void {
    this.messagesEl.innerHTML = ''
    for (const msg of messages) {
      this.appendMessage(msg)
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private appendMessage(msg: ClarifyMessage): void {
    const bubble = document.createElement('div')
    bubble.className = msg.role === 'user' ? 'mtb-clarify-bubble mtb-clarify-user' : 'mtb-clarify-bubble mtb-clarify-ai'
    bubble.textContent = msg.content
    this.messagesEl.appendChild(bubble)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private showThinking(): void {
    if (this.messagesEl.querySelector('.mtb-clarify-thinking')) return
    const dots = document.createElement('div')
    dots.className = 'mtb-clarify-bubble mtb-clarify-ai mtb-clarify-thinking'
    dots.innerHTML = '<span class="mtb-dot"></span><span class="mtb-dot"></span><span class="mtb-dot"></span>'
    this.messagesEl.appendChild(dots)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private removeThinking(): void {
    this.messagesEl.querySelector('.mtb-clarify-thinking')?.remove()
  }

  destroy(): void {
    this.destroyed = true
    this.stopPolling()
    this.el.remove()
  }
}

