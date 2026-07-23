import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { ApiClient, ClarifyStreamResult } from '../api/client'
import type { ClarifyMessage, ClarifyResponse } from '../types'
import { escapeHtml } from '../context/dom-utils'

const POLL_INTERVAL_MS = 2000
// Give up polling after this long with no assistant reply so the card never
// spins forever (e.g. a backend job that silently died).
const POLL_TIMEOUT_MS = 45000

interface ClarifyCardOptions {
  submissionSessionId: string
  submissionToken: string
  apiClient: ApiClient
  messages: I18nMessages
  onFinalize: () => Promise<void> | void
  element?: HTMLDivElement
  position?: 'left' | 'right'
  x?: number
  y?: number
  preloadedResult?: ClarifyStreamResult
  pendingClarification?: Promise<ClarifyStreamResult | null>
}

const CARD_WIDTH = 346
const CARD_HEIGHT = 270

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
  private lastMessages: ClarifyMessage[] = []
  private done = false
  private sending = false
  private finalizing = false
  private destroyed = false

  private preloadedResult?: ClarifyStreamResult
  private pendingClarification?: Promise<ClarifyStreamResult | null>

  constructor(shadow: ShadowContainer, opts: ClarifyCardOptions) {
    this.submissionSessionId = opts.submissionSessionId
    this.submissionToken = opts.submissionToken
    this.apiClient = opts.apiClient
    this.onFinalize = opts.onFinalize
    this.i18n = opts.messages
    this.preloadedResult = opts.preloadedResult
    this.pendingClarification = opts.pendingClarification

    const existingElement = opts.element
    this.el = existingElement ?? shadow.el<HTMLDivElement>('div', 'mtb-clarify')
    this.el.className = existingElement ? 'mtb-clarify mtb-clarify-continuation' : 'mtb-clarify'
    this.el.innerHTML = this.buildHTML(opts.messages)
    if (!existingElement) {
      shadow.append(this.el)
      this.positionCard(opts.x, opts.y, opts.position ?? 'right')
    }

    this.messagesEl = this.el.querySelector('.mtb-clarify-messages')!
    this.bindEvents()
    this.startConversation()
  }

  // Anchors the card near the annotation point, clamped to the viewport so it
  // never overflows a screen edge (mirrors CommentPopup.positionPopup).
  private positionCard(x: number | undefined, y: number | undefined, tabPosition: 'left' | 'right'): void {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 12
    const tabWidth = 32
    const cardW = Math.min(CARD_WIDTH, vw - 2 * margin - tabWidth)
    const cardH = this.el.offsetHeight || CARD_HEIGHT
    const minLeft = margin + (tabPosition === 'left' ? tabWidth : 0)
    const maxRight = vw - margin - (tabPosition === 'right' ? tabWidth : 0)

    if (x === undefined || y === undefined) {
      const centeredLeft = Math.max(minLeft, (vw - cardW) / 2)
      this.el.style.left = `${Math.min(centeredLeft, maxRight - cardW)}px`
      this.el.style.top = `${Math.max(margin, (vh - cardH) / 2)}px`
      this.el.style.maxHeight = `${vh - 2 * margin}px`
      return
    }

    let left = x + 12
    let top = y + 12
    if (left + cardW > maxRight) left = x - cardW - 12
    if (left + cardW > maxRight) left = maxRight - cardW
    if (left < minLeft) left = minLeft
    if (top + cardH > vh - margin) top = vh - cardH - margin
    if (top < margin) top = margin

    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
    this.el.style.maxHeight = `${vh - top - margin}px`
  }

  private buildHTML(m: I18nMessages): string {
    return `
      <div class="mtb-clarify-header">
        <span class="mtb-clarify-icon">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z"/>
          </svg>
        </span>
        <div class="mtb-clarify-titles">
          <div class="mtb-clarify-title">${escapeHtml(m.clarify.title)}</div>
          <div class="mtb-clarify-subtitle">${escapeHtml(m.clarify.subtitle)}</div>
        </div>
        <button class="mtb-clarify-close" type="button" title="${escapeHtml(m.clarify.skip)}" aria-label="${escapeHtml(m.clarify.skip)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="mtb-clarify-messages"></div>
      <div class="mtb-clarify-footer">${this.buildConversationControls(m)}</div>
    `
  }

  private buildConversationControls(m: I18nMessages): string {
    return `
      <textarea class="mtb-clarify-input" rows="1" placeholder="${escapeHtml(m.clarify.placeholder)}"></textarea>
      <div class="mtb-clarify-actions">
        <button class="mtb-clarify-skip" type="button">${escapeHtml(m.clarify.skip)}</button>
        <button class="mtb-clarify-send" type="button" disabled>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <span>${escapeHtml(m.clarify.send)}</span>
        </button>
      </div>
    `
  }

  private bindEvents(): void {
    this.el.querySelector('.mtb-clarify-close')!.addEventListener('click', () => this.skipAndFinalize())
    this.bindConversationControls()
  }

  private bindConversationControls(): void {
    this.inputEl = this.el.querySelector('.mtb-clarify-input')!
    this.sendBtn = this.el.querySelector('.mtb-clarify-send')!
    this.el.querySelector('.mtb-clarify-skip')!.addEventListener('click', () => this.skipAndFinalize())

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

  private skipAndFinalize(): void {
    this.stopPolling()
    void this.finalize()
  }

  private async startConversation(): Promise<void> {
    if (this.preloadedResult) {
      this.applyResult(this.preloadedResult)
      return
    }

    if (this.pendingClarification) {
      this.showThinking()
      try {
        const result = await this.pendingClarification
        if (this.destroyed) return
        if (result) {
          if (!this.applyResult(result)) this.startPolling()
        } else {
          await this.runInitialTurnViaPolling()
        }
      } catch {
        if (this.destroyed) return
        await this.runInitialTurnViaPolling()
      }
      return
    }

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
      if (!this.applyResult(result)) this.startPolling()
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
      if (!this.applyResult(res)) this.startPolling()
    } catch {
      if (this.destroyed) return
      this.handleFailure()
    }
  }

  private async runAnswerTurn(message: string): Promise<void> {
    const res = await this.apiClient.startClarification(
      this.submissionSessionId,
      this.submissionToken,
      message,
    )
    if (this.destroyed) return
    if (!this.applyResult(res)) this.startPolling()
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
      this.handleFailure()
      return
    }
    try {
      const res = await this.apiClient.getClarification(
        this.submissionSessionId,
        this.submissionToken,
      )
      if (this.destroyed) return
      if (this.applyResult(res)) this.stopPolling()
    } catch {
      if (this.destroyed) return
      this.stopPolling()
      this.handleFailure()
    }
  }

  private handleDone(): void {
    if (this.done) return
    this.done = true
    this.stopPolling()
    this.removeThinking()
    this.showFinalizeButton()
  }

  private handleFailure(): void {
    if (this.done) return
    this.done = true
    this.stopPolling()
    this.removeThinking()
    this.showClarificationFailureActions()
  }

  private showClarificationFailureActions(): void {
    const footer = this.el.querySelector('.mtb-clarify-footer')!
    footer.innerHTML = `
      <div class="mtb-clarify-error">${escapeHtml(this.i18n.clarify.error)}</div>
      <div class="mtb-clarify-actions">
        <button class="mtb-clarify-fallback" type="button">${escapeHtml(this.i18n.clarify.send_feedback)}</button>
        <button class="mtb-clarify-retry" type="button">${escapeHtml(this.i18n.clarify.retry)}</button>
      </div>
    `
    footer.querySelector('.mtb-clarify-fallback')!.addEventListener('click', () => this.skipAndFinalize())
    footer.querySelector('.mtb-clarify-retry')!.addEventListener('click', () => {
      if (!this.destroyed) void this.retryClarification()
    })
  }

  private async retryClarification(): Promise<void> {
    if (this.sending || this.destroyed) return

    this.sending = true
    this.done = false
    this.showConversationControls()
    this.inputEl.disabled = true
    this.sendBtn.disabled = true
    this.renderConversation(this.lastMessages, false)

    try {
      const snapshot = await this.apiClient.getClarification(this.submissionSessionId, this.submissionToken)
      let result = snapshot
      if (snapshot.status === 'failed') {
        result = await this.apiClient.retryClarification(this.submissionSessionId, this.submissionToken)
      } else if (snapshot.status === 'pending') {
        result = await this.apiClient.startClarification(this.submissionSessionId, this.submissionToken)
      }
      if (this.destroyed) return
      if (!this.applyResult(result)) {
        this.showConversationControls()
        this.startPolling()
      }
    } catch {
      if (this.destroyed) return
      this.handleFailure()
    } finally {
      this.sending = false
    }
  }

  private showConversationControls(): void {
    const footer = this.el.querySelector('.mtb-clarify-footer')!
    footer.innerHTML = this.buildConversationControls(this.i18n)
    this.bindConversationControls()
  }

  private applyResult(result: ClarifyStreamResult | ClarifyResponse): boolean {
    this.renderConversation(result.messages, result.done)
    const failed = 'status' in result ? result.status === 'failed' : result.failed === true
    if (failed) {
      this.handleFailure()
      return true
    }
    if (result.done) {
      this.handleDone()
      return true
    }
    return false
  }

  private showFinalizeButton(): void {
    const footer = this.el.querySelector('.mtb-clarify-footer')!
    footer.innerHTML = `
      <button class="mtb-clarify-send-feedback" type="button">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        <span>${escapeHtml(this.i18n.clarify.send_feedback)}</span>
      </button>
    `
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
      this.clearError()
      this.showError()
      this.showRetryButton()
    }
  }

  private showRetryButton(): void {
    const footer = this.el.querySelector('.mtb-clarify-footer')!
    footer.innerHTML = `<button class="mtb-clarify-send-feedback mtb-clarify-retry" type="button">${escapeHtml(this.i18n.clarify.retry)}</button>`
    footer.querySelector('.mtb-clarify-retry')!.addEventListener('click', () => {
      if (!this.destroyed) void this.finalize()
    })
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
