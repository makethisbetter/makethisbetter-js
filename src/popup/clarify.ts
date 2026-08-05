import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { ApiClient } from '../api/client'
import type { ClarifyMessage, SubmissionSessionResponse } from '../types'
import { escapeHtml, isImeConfirmKeydown } from '../context/dom-utils'
import { ClarifySession, type ClarifySessionHost } from './clarify-session'
import { SheetLayout } from './sheet'
import { measureViewportFrame, panelWidth, VIEWPORT_MARGIN } from './position'
import { trapFocus, type FocusTrap } from './focus-trap'

interface ClarifyCardOptions {
  // Either the session is already known, or it is still being created — the
  // card mounts immediately either way and shows its thinking bubble while
  // pendingSession settles.
  submissionSessionId?: string
  submissionToken?: string
  pendingSession?: Promise<SubmissionSessionResponse | null>
  onRetrySubmission?: () => Promise<SubmissionSessionResponse | null>
  apiClient: ApiClient
  messages: I18nMessages
  onFinalize: () => Promise<void> | void
  initiatingKeydown?: KeyboardEvent
  onSkip?: () => void
  onCancel?: () => void
  element?: HTMLDivElement
  position?: 'left' | 'right'
  x?: number
  y?: number
}

const CARD_WIDTH = 346
const CARD_HEIGHT = 270

/**
 * The clarify card's DOM: markup, footers, composer bindings, focus trap, and
 * positioning. Every conversation decision — which turn runs next, when to
 * poll, when to finalize — belongs to ClarifySession; this class only paints
 * what the session decides and forwards reporter input back to it.
 */
export class ClarifyCard implements ClarifySessionHost {
  private el: HTMLDivElement
  private sheet: SheetLayout
  private focusTrap: FocusTrap
  private messagesEl!: HTMLDivElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private streamingBubble: HTMLDivElement | null = null
  private session: ClarifySession
  private initiatingKeydown?: KeyboardEvent
  private i18n: I18nMessages
  private handleKeydown = (event: KeyboardEvent): void => {
    if (event === this.initiatingKeydown) {
      this.initiatingKeydown = undefined
      return
    }
    if (isImeConfirmKeydown(event) || event.key !== 'Enter' || event.shiftKey) return
    if (event.composedPath().includes(this.inputEl)) return

    event.preventDefault()
    this.session.skip()
  }

  constructor(shadow: ShadowContainer, opts: ClarifyCardOptions) {
    this.initiatingKeydown = opts.initiatingKeydown
    this.i18n = opts.messages

    const existingElement = opts.element
    this.el = existingElement ?? shadow.el<HTMLDivElement>('div', 'mtb-clarify')
    this.el.className = existingElement ? 'mtb-clarify mtb-clarify-continuation' : 'mtb-clarify'
    // Set on every construction: a continuation inherits the comment popup's
    // element and with it that popup's dialog label, which no longer describes
    // what is on screen.
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.setAttribute('aria-label', opts.messages.clarify.title)
    this.el.innerHTML = this.buildHTML(opts.messages)
    this.sheet = new SheetLayout(this.el)
    if (!existingElement) {
      shadow.append(this.el)
      this.positionCard(opts.x, opts.y, opts.position ?? 'right')
    } else {
      // A continuation inherits the comment popup's element, and with it the
      // sheet layout that popup was using — but the class just changed from
      // .mtb-popup to .mtb-clarify, so the sheet rules stop matching and the
      // cleared inline offsets leave a fixed element with nowhere to sit.
      // Re-applying binds the new class to the same geometry and re-attaches
      // the keyboard tracking the released popup gave up.
      this.sheet.apply()
    }
    this.focusTrap = trapFocus(this.el)

    this.messagesEl = this.el.querySelector('.mtb-clarify-messages')!
    this.session = new ClarifySession({
      submissionSessionId: opts.submissionSessionId,
      submissionToken: opts.submissionToken,
      pendingSession: opts.pendingSession,
      onRetrySubmission: opts.onRetrySubmission,
      apiClient: opts.apiClient,
      onFinalize: opts.onFinalize,
      onSkip: opts.onSkip,
      onCancel: opts.onCancel,
    }, this)
    this.bindEvents()
    // Listen immediately so a queued second Enter cannot arrive first. The
    // exact keydown that created this card is passed in and ignored by identity
    // when it continues propagating from the shadow textarea to window.
    window.addEventListener('keydown', this.handleKeydown)
    void this.session.start()
  }

  // Anchors the card near the annotation point, clamped to the viewport so it
  // never overflows a screen edge (the margin/tab geometry is shared with
  // CommentPopup through position.ts).
  private positionCard(x: number | undefined, y: number | undefined, tabPosition: 'left' | 'right'): void {
    if (this.sheet.apply()) return

    const frame = measureViewportFrame(tabPosition)
    const { vw, vh, minLeft, maxRight } = frame
    const margin = VIEWPORT_MARGIN
    const cardW = panelWidth(CARD_WIDTH, frame)
    const cardH = this.el.offsetHeight || CARD_HEIGHT

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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mtb-brand-on-primary)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2v6h-6"/>
            <path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>
            <circle cx="12" cy="12" r="2.2" fill="var(--mtb-brand-on-primary)" stroke="none"/>
          </svg>
        </span>
        <div class="mtb-clarify-titles">
          <div class="mtb-clarify-title">${escapeHtml(m.clarify.title)}</div>
          <div class="mtb-clarify-subtitle">${escapeHtml(m.clarify.subtitle)}</div>
        </div>
        <button class="mtb-clarify-close" type="button" title="${escapeHtml(m.clarify.cancel)}" aria-label="${escapeHtml(m.clarify.cancel)}">
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
        <button class="mtb-clarify-send" type="button" aria-label="${escapeHtml(m.clarify.send)}" disabled>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mtb-brand-on-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <span class="mtb-clarify-send-label">${escapeHtml(m.clarify.send)}</span>
          <span class="mtb-clarify-send-spinner" aria-hidden="true"></span>
        </button>
      </div>
    `
  }

  private bindEvents(): void {
    this.el.querySelector('.mtb-clarify-close')!.addEventListener('click', () => this.session.close())
    this.bindConversationControls()
  }

  private bindConversationControls(): void {
    this.inputEl = this.el.querySelector('.mtb-clarify-input')!
    this.sendBtn = this.el.querySelector('.mtb-clarify-send')!
    this.el.querySelector('.mtb-clarify-skip')!.addEventListener('click', () => this.session.skip())

    this.inputEl.addEventListener('input', () => {
      this.sendBtn.disabled = !this.inputEl.value.trim()
    })

    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (isImeConfirmKeydown(e)) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.sendMessage()
      }
    })

    this.sendBtn.addEventListener('click', () => this.sendMessage())
  }

  private sendMessage(): void {
    void this.session.sendAnswer(this.inputEl.value.trim())
  }

  // ---- ClarifySessionHost ----

  setInputDisabled(disabled: boolean): void {
    this.inputEl.disabled = disabled
  }

  onAnswerTurnStarted(text: string): void {
    this.inputEl.disabled = true
    this.sendBtn.disabled = true
    this.sendBtn.setAttribute('aria-busy', 'true')
    this.appendMessage({ role: 'user', content: text })
    this.inputEl.value = ''
    this.clearError()
  }

  onAnswerTurnFailed(messages: ClarifyMessage[], text: string): void {
    this.renderConversation(messages, false)
    this.inputEl.value = text
    this.showError()
    this.sendBtn.removeAttribute('aria-busy')
    this.inputEl.disabled = false
    this.sendBtn.disabled = !this.inputEl.value.trim()
    this.inputEl.focus({ preventScroll: true })
  }

  onRetryStarted(messages: ClarifyMessage[]): void {
    this.showConversationControls()
    this.inputEl.disabled = true
    this.sendBtn.disabled = true
    this.renderConversation(messages, false)
  }

  onFinalizeStarted(): void {
    this.el.querySelector('.mtb-clarify-send')?.setAttribute('aria-busy', 'true')
    // The header X stays live: during finalizing it dismisses the card while
    // the send continues in the background (see ClarifySession.close), so it
    // must not be swept up in the busy-state disable.
    this.el.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      if (!button.classList.contains('mtb-clarify-close')) button.disabled = true
    })
  }

  renderSubmissionFailureFooter(): void {
    this.renderFooter({
      error: this.i18n.error.submit,
      controls: `<button class="mtb-clarify-send-feedback mtb-clarify-retry" type="button">${escapeHtml(this.i18n.clarify.retry)}</button>`,
      bind: (footer) => {
        footer.querySelector('.mtb-clarify-retry')!.addEventListener('click', () => {
          void this.session.retrySubmission()
        })
      },
    })
  }

  renderClarifyFailureFooter(): void {
    this.renderFooter({
      error: this.i18n.clarify.error,
      controls: `
        <div class="mtb-clarify-actions">
          <button class="mtb-clarify-fallback" type="button">${escapeHtml(this.i18n.clarify.send_feedback)}</button>
          <button class="mtb-clarify-retry" type="button">${escapeHtml(this.i18n.clarify.retry)}</button>
        </div>
      `,
      bind: (footer) => {
        footer.querySelector('.mtb-clarify-fallback')!.addEventListener('click', () => this.session.skip())
        footer.querySelector('.mtb-clarify-retry')!.addEventListener('click', () => {
          void this.session.retryClarification()
        })
      },
    })
  }

  renderFinalizeButton(): void {
    this.renderFooter({
      controls: `
        <button class="mtb-clarify-send-feedback" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mtb-brand-on-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          <span>${escapeHtml(this.i18n.clarify.send_feedback)}</span>
        </button>
      `,
      bind: (footer) => {
        footer.querySelector('.mtb-clarify-send-feedback')!.addEventListener('click', () => {
          void this.session.finalize()
        })
      },
    })
  }

  renderFinalizeRetryFooter(): void {
    this.renderFooter({
      error: this.i18n.error.submit,
      controls: `<button class="mtb-clarify-send-feedback mtb-clarify-retry" type="button">${escapeHtml(this.i18n.clarify.retry)}</button>`,
      bind: (footer) => {
        footer.querySelector('.mtb-clarify-retry')!.addEventListener('click', () => {
          void this.session.finalize()
        })
      },
    })
  }

  renderUnrecoverableFooter(): void {
    this.renderFooter({ error: this.i18n.clarify.expired })
  }

  showConversationControls(): void {
    this.renderFooter({
      controls: this.buildConversationControls(this.i18n),
      bind: () => this.bindConversationControls(),
    })
  }

  enableInput(): void {
    if (!this.el.contains(this.inputEl)) this.showConversationControls()
    this.inputEl.disabled = false
    this.sendBtn.disabled = !this.inputEl.value.trim()
  }

  clearError(): void {
    this.el.querySelector('.mtb-clarify-error')?.remove()
  }

  private showError(): void {
    const footer = this.el.querySelector('.mtb-clarify-footer')!
    const error = document.createElement('div')
    error.className = 'mtb-clarify-error'
    error.textContent = this.i18n.error.submit
    footer.prepend(error)
  }

  appendStreamDelta(text: string): void {
    if (!this.streamingBubble) {
      this.removeThinking()
      this.streamingBubble = document.createElement('div')
      this.streamingBubble.className = 'mtb-clarify-bubble mtb-clarify-ai'
      this.messagesEl.appendChild(this.streamingBubble)
    }
    this.streamingBubble.textContent = (this.streamingBubble.textContent ?? '') + text
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  endStreamingBubble(): void {
    this.streamingBubble = null
  }

  // Every footer state renders through here, reason and controls in one pass:
  // replacing the footer wholesale is what used to discard the error message
  // showError() had just prepended, so the reporter saw a bare Retry button
  // with no explanation.
  private renderFooter(opts: { error?: string; controls?: string; bind?: (footer: HTMLElement) => void }): void {
    const footer = this.el.querySelector<HTMLElement>('.mtb-clarify-footer')!
    const error = opts.error ? `<div class="mtb-clarify-error">${escapeHtml(opts.error)}</div>` : ''
    footer.innerHTML = `${error}${opts.controls ?? ''}`
    opts.bind?.(footer)
  }

  renderConversation(messages: ClarifyMessage[], done: boolean): void {
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

  showThinking(): void {
    if (this.messagesEl.querySelector('.mtb-clarify-thinking')) return
    const dots = document.createElement('div')
    dots.className = 'mtb-clarify-bubble mtb-clarify-ai mtb-clarify-thinking'
    dots.innerHTML = '<span class="mtb-dot"></span><span class="mtb-dot"></span><span class="mtb-dot"></span>'
    this.messagesEl.appendChild(dots)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  removeThinking(): void {
    this.messagesEl.querySelector('.mtb-clarify-thinking')?.remove()
  }

  dismiss(): void {
    this.destroy()
  }

  destroy(): void {
    this.session.dispose()
    window.removeEventListener('keydown', this.handleKeydown)
    this.sheet.release()
    this.focusTrap.release()
    this.el.remove()
    this.focusTrap.restoreFocus()
  }
}
