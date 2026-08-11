import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { ClarifyStreamResult } from '../api/client'
import type { SubmissionSessionResponse, TargetRect } from '../types'
import { escapeHtml, isImeConfirmKeydown } from '../context/dom-utils'
import { SheetLayout } from './sheet'
import { measureViewportFrame, panelWidth, VIEWPORT_MARGIN } from './position'
import { trapFocus, type FocusTrap } from './focus-trap'

type ChatState = 'idle' | 'sending' | 'clarifying' | 'answering' | 'done'

interface ChatPopupOptions {
  targetName: string
  x: number
  y: number
  targetRect?: TargetRect
  messages: I18nMessages
  position?: 'left' | 'right'
  screenshotEnabled?: boolean
  onScreenshotToggle?: (enabled: boolean) => void
  onSubmit: (description: string) => Promise<SubmissionSessionResponse | null>
  onClarify: (sessionId: string, token: string, onDelta: (text: string) => void, signal?: AbortSignal) => Promise<ClarifyStreamResult>
  onAnswer: (sessionId: string, token: string, message: string) => Promise<unknown>
  onFinalize: () => Promise<void> | void
  onCancel: () => void
  /** A question is on screen: the card now holds an uploaded submission. */
  onConversationOpen?: () => void
  onActivity?: () => void
  recordingSeconds?: number
  // Resolved when the success view renders, not at mount: both depend on the
  // handoff the finalize returns, which does not exist while the reporter is
  // still typing.
  resolveBoardLink?: () => (() => void) | undefined
  resolveEmailCapture?: () => { onSubmit: (email: string) => Promise<boolean> } | undefined
}

const CARD_WIDTH = 320
const AUTO_CLOSE_MS = 5000

const BRAND_URL = 'https://makethisbetter.dev'

const BRAND_ICON = '<svg viewBox="0 0 512 512" fill="none"><defs><linearGradient id="mtb-bg" x1=".3" y1="0" x2=".7" y2="1"><stop offset="0%" stop-color="var(--mtb-chat-logo-start, #10b981)"/><stop offset="100%" stop-color="var(--mtb-chat-logo-end, #059669)"/></linearGradient></defs><rect width="512" height="512" rx="96" fill="url(#mtb-bg)"/><g transform="translate(89,89) scale(13.9)" stroke="var(--mtb-chat-logo-fg, #fff)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/><circle cx="12" cy="12" r="2.2" fill="var(--mtb-chat-logo-fg, #fff)" stroke="none"/></g></svg>'
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.9 8l3.3-3.3-.9-.9L8 7.1 4.7 3.8l-.9.9L7.1 8l-3.3 3.3.9.9L8 8.9l3.3 3.3.9-.9z"/></svg>'
const CAMERA_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.2 2.6h3.6l.9 1.4H14a1 1 0 011 1v7.4a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1h3.3l.9-1.4z"/><circle cx="8" cy="9" r="2.5" class="mtb-chat-icon-lens"/></svg>'
const RECORD_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6.6"/><polygon points="6.4,5.2 11,8 6.4,10.8" class="mtb-chat-icon-lens"/></svg>'
const CHECK_ICON = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8.1 14.6L3.8 10.3l1.5-1.5 2.8 2.8 6.6-6.6 1.5 1.5z"/></svg>'

export class ChatPopup {
  private el: HTMLDivElement
  private sheet: SheetLayout
  private focusTrap: FocusTrap
  private messagesEl!: HTMLDivElement
  private composerEl!: HTMLDivElement
  private actionsEl!: HTMLDivElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private quickRepliesEl!: HTMLDivElement
  private state: ChatState = 'idle'
  private i18n: I18nMessages
  private opts: ChatPopupOptions
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null
  private session: SubmissionSessionResponse | null = null
  private clarifyAbort: AbortController | null = null

  constructor(shadow: ShadowContainer, opts: ChatPopupOptions) {
    this.opts = opts
    this.i18n = opts.messages

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-chat')
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.setAttribute('aria-label', opts.targetName)
    this.el.innerHTML = this.buildHTML()
    shadow.append(this.el)
    this.focusTrap = trapFocus(this.el)
    this.sheet = new SheetLayout(this.el)
    if (!this.sheet.apply()) {
      this.positionCard(opts.x, opts.y, opts.targetRect, opts.position ?? 'right')
    }

    this.messagesEl = this.el.querySelector('.mtb-chat-messages')!
    this.composerEl = this.el.querySelector('.mtb-chat-composer')!
    this.actionsEl = this.el.querySelector('.mtb-chat-actions')!
    this.inputEl = this.el.querySelector('.mtb-chat-input')!
    this.sendBtn = this.el.querySelector('.mtb-chat-send')!
    this.quickRepliesEl = this.el.querySelector('.mtb-chat-quick-replies')!

    this.bindEvents()
    this.handleEscape = this.handleEscape.bind(this)
    window.addEventListener('keydown', this.handleEscape)
    this.inputEl.focus({ preventScroll: true })
  }

  private handleEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (this.state === 'sending') return
    if (this.state === 'done') {
      this.destroy()
      return
    }
    this.opts.onCancel()
  }

  private buildHTML(): string {
    const m = this.i18n
    const opts = this.opts
    const quickOpts = m.popup.quickOptions
      .map(o => `<button class="mtb-chat-qr" type="button" data-quick="${escapeHtml(o.label)}" data-value="${escapeHtml(o.value ?? o.label)}">${escapeHtml(o.emoji)} ${escapeHtml(o.label)}</button>`)
      .join('')

    const capture = opts.recordingSeconds != null
      ? `<span class="mtb-chat-attachment" title="${escapeHtml(m.popup.recording_locked_hint)}">${RECORD_ICON}<span class="mtb-chat-capture-label">${Math.round(opts.recordingSeconds)}s</span></span>`
      : opts.onScreenshotToggle
        ? `<button class="mtb-chat-screenshot" type="button" title="${escapeHtml(m.popup.screenshot_hint)}" aria-pressed="${opts.screenshotEnabled !== false}">${CAMERA_ICON}<span class="mtb-chat-capture-label">${escapeHtml(m.popup.screenshot_short)}</span></button>`
        : ''

    return `
      <div class="mtb-chat-header">
        <div class="mtb-chat-handle"></div>
        <div class="mtb-chat-header-row">
          <a class="mtb-chat-brand" href="${BRAND_URL}" target="_blank" rel="noopener">
            <span class="mtb-chat-logo">${BRAND_ICON}</span>
            <span class="mtb-chat-brand-name">Make This Better</span>
          </a>
          <span class="mtb-chat-header-gap"></span>
          <button class="mtb-chat-close" type="button" aria-label="${escapeHtml(m.popup.close)}">${CLOSE_ICON}</button>
        </div>
      </div>
      <div class="mtb-chat-messages"></div>
      <div class="mtb-chat-quick-replies">${quickOpts}</div>
      <div class="mtb-chat-composer">
        <textarea class="mtb-chat-input" rows="1" placeholder="${escapeHtml(m.popup.placeholder)}"></textarea>
        <div class="mtb-chat-actions">
          ${capture}
          <span class="mtb-chat-actions-gap"></span>
          <button class="mtb-chat-send" type="button" disabled>${escapeHtml(m.clarify.send)}</button>
        </div>
      </div>
    `
  }

  private bindEvents(): void {
    this.el.querySelector('.mtb-chat-close')!.addEventListener('click', () => {
      this.opts.onCancel()
    })

    this.quickRepliesEl.querySelectorAll('.mtb-chat-qr').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = (btn as HTMLElement).dataset['value'] ?? (btn as HTMLElement).dataset['quick'] ?? ''
        this.inputEl.value = value
        this.sendMessage(value)
      })
    })

    this.inputEl.addEventListener('input', () => {
      this.sendBtn.disabled = !this.inputEl.value.trim()
      this.opts.onActivity?.()
    })

    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (isImeConfirmKeydown(e)) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const text = this.inputEl.value.trim()
        if (text) {
          this.sendMessage(text)
        } else if (this.state === 'clarifying') {
          this.skipAndSend()
        }
      }
    })

    this.sendBtn.addEventListener('click', () => {
      const text = this.inputEl.value.trim()
      if (text) this.sendMessage(text)
    })

    const screenshotBtn = this.el.querySelector('.mtb-chat-screenshot')
    if (screenshotBtn && this.opts.onScreenshotToggle) {
      screenshotBtn.addEventListener('click', () => {
        const pressed = screenshotBtn.getAttribute('aria-pressed') === 'true'
        screenshotBtn.setAttribute('aria-pressed', String(!pressed))
        screenshotBtn.classList.toggle('mtb-chat-screenshot-off', pressed)
        this.opts.onScreenshotToggle!(!pressed)
      })
    }
  }

  private async sendMessage(text: string): Promise<void> {
    if (this.state === 'sending' || this.state === 'answering') return

    if (this.state === 'clarifying') {
      this.handleAnswer(text)
      return
    }

    this.state = 'sending'
    this.appendUserBubble(text)
    this.quickRepliesEl.style.display = 'none'
    this.hideCapture()
    this.showThinking()
    this.setComposerDisabled(true)

    let session: SubmissionSessionResponse | null
    try {
      session = await this.opts.onSubmit(text)
    } catch {
      session = null
    }

    if (!session) {
      this.removeThinking()
      this.setComposerDisabled(false)
      this.showRetryableError(this.i18n.error.submit, () => {
        this.clearError()
        void this.sendMessage(text)
      })
      this.state = 'idle'
      return
    }

    this.session = session

    if (!session.ai_clarify_available) {
      this.removeThinking()
      void this.showDone()
      return
    }

    let result: ClarifyStreamResult | null = null
    let streaming = false
    this.clarifyAbort = new AbortController()
    try {
      result = await this.opts.onClarify(session.id, session.token, (delta) => {
        if (!streaming) {
          this.removeThinking()
          this.startStreamingBubble()
          streaming = true
        }
        this.appendStreamDelta(delta)
      }, this.clarifyAbort.signal)
    } catch {
      if (!streaming) this.removeThinking()
      else this.endStreamingBubble()
      this.showDone()
      return
    }

    if (!streaming) this.removeThinking()
    else this.endStreamingBubble()

    if (result.done || !result.messages.length) {
      void this.showDone()
      return
    }

    const aiMessage = result.messages.find(msg => msg.role === 'assistant')
    if (!streaming && aiMessage) {
      this.appendAiBubble(aiMessage.content)
    }
    this.renderSuggestions(result.suggestions)
    this.state = 'clarifying'
    this.setComposerDisabled(false)
    this.inputEl.value = ''
    this.inputEl.placeholder = this.i18n.clarify.placeholder
    this.sendBtn.textContent = this.i18n.clarify.submit ?? this.i18n.clarify.send
    this.sendBtn.disabled = true
    this.showSkip()
    this.inputEl.focus({ preventScroll: true })
    this.opts.onConversationOpen?.()
  }

  private handleAnswer(text: string): void {
    const session = this.session
    if (!session) return
    this.state = 'done'
    this.appendUserBubble(text)
    this.clearSuggestions()
    this.hideSkip()
    this.setComposerDisabled(true)
    this.renderSuccess()
    // The answer has to reach the server before finalize runs: finalizing
    // deactivates the session, after which the server rejects the answer as
    // terminal. A failed answer still finalizes — losing the follow-up answer
    // must never lose the feedback itself.
    Promise.resolve(this.opts.onAnswer(session.id, session.token, text))
      .catch(() => {})
      .then(() => this.finalizeInBackground())
  }

  /**
   * The receipt goes up the moment the reporter is done rather than waiting on
   * the finalize round trip; the hand-off it returns is patched into the card
   * when it lands. A failed finalize replaces this receipt with an in-card
   * retry state so the reporter stays in the conversation they used.
   */
  private showDone(): void {
    this.state = 'done'
    this.hideSkip()
    this.setComposerDisabled(true)
    this.renderSuccess()
    this.finalizeInBackground()
  }

  /**
   * The success view takes over everything under the header — the transcript,
   * the quick replies and the composer are all gone, so the card reads as a
   * receipt rather than a conversation the reporter could keep typing into.
   */
  private renderSuccess(): void {
    const m = this.i18n.success
    this.messagesEl.remove()
    this.quickRepliesEl.remove()
    this.composerEl.remove()

    const view = this.el.querySelector<HTMLDivElement>('.mtb-chat-success') ?? document.createElement('div')
    view.className = 'mtb-chat-success mtb-chat-success-simple'
    view.replaceChildren()

    const icon = document.createElement('div')
    icon.className = 'mtb-chat-success-icon'
    icon.innerHTML = CHECK_ICON
    view.appendChild(icon)

    const title = document.createElement('div')
    title.className = 'mtb-chat-success-title'
    title.textContent = this.session?.ai_clarify_available === false ? m.title_no_ai : m.title
    view.appendChild(title)

    const link = document.createElement('a')
    link.className = 'mtb-chat-success-link mtb-chat-success-link-pending'
    link.href = '#'
    link.textContent = m.track_feedback
    link.addEventListener('click', (e: MouseEvent) => e.preventDefault())
    view.appendChild(link)

    if (!view.parentElement) this.el.appendChild(view)
    this.attachHandoff()
  }

  /** Keep a failed background finalize in the conversation the reporter used. */
  showFinalizeFailure(onRetry?: () => void): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer)
      this.autoCloseTimer = null
    }

    let view = this.el.querySelector<HTMLDivElement>('.mtb-chat-success')
    if (!view) {
      this.messagesEl.remove()
      this.quickRepliesEl.remove()
      this.composerEl.remove()
      view = document.createElement('div')
      this.el.appendChild(view)
    }

    view.className = 'mtb-chat-success mtb-chat-finalize-failure'
    view.innerHTML = `
      <div class="mtb-chat-success-icon mtb-chat-failure-icon">!</div>
      <div class="mtb-chat-success-title">${escapeHtml(this.i18n.error.finalize_title)}</div>
      <div class="mtb-chat-finalize-message">${escapeHtml(this.i18n.error.finalize_message)}</div>
      ${onRetry ? `<button class="mtb-chat-finalize-retry" type="button">${escapeHtml(this.i18n.clarify.retry)}</button>` : ''}
      <button class="mtb-chat-finalize-close" type="button">${escapeHtml(this.i18n.success.close)}</button>
    `

    if (onRetry) {
      view.querySelector<HTMLButtonElement>('.mtb-chat-finalize-retry')!.addEventListener('click', () => {
        const retry = view.querySelector<HTMLButtonElement>('.mtb-chat-finalize-retry')!
        retry.disabled = true
        retry.innerHTML = '<span class="mtb-chat-finalize-spinner" aria-label="Retrying"></span>'
        onRetry()
      })
    }
    view.querySelector<HTMLButtonElement>('.mtb-chat-finalize-close')!.addEventListener('click', () => this.opts.onCancel())
  }

  /** Restore the receipt after a retry reaches the final endpoint. */
  showFinalizeSuccess(): void {
    this.state = 'done'
    this.renderSuccess()
  }

  /**
   * The board link and the email form are both built from the hand-off that
   * finalize returns, but the receipt renders the moment the reporter is done
   * rather than waiting on that round trip — so this runs twice: once against
   * whatever is already known, and again when finalize lands.
   */
  private attachHandoff(): void {
    const view = this.el.querySelector<HTMLDivElement>('.mtb-chat-success')
    if (!view) return
    const m = this.i18n.success

    const openBoard = this.opts.resolveBoardLink?.()
    const pendingLink = view.querySelector<HTMLAnchorElement>('.mtb-chat-success-link-pending')
    if (openBoard && pendingLink) {
      pendingLink.classList.remove('mtb-chat-success-link-pending')
      pendingLink.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault()
        openBoard()
      })
    }

    const emailCapture = this.opts.resolveEmailCapture?.()
    if (emailCapture && !view.querySelector('.mtb-chat-email-card')) {
      if (this.autoCloseTimer) {
        clearTimeout(this.autoCloseTimer)
        this.autoCloseTimer = null
      }
      view.classList.remove('mtb-chat-success-simple')
      view.appendChild(this.buildEmailCard(emailCapture))
    } else if (this.finalized && !emailCapture && !this.autoCloseTimer && !view.querySelector('.mtb-chat-email-card')) {
      this.autoCloseTimer = setTimeout(() => this.destroy(), AUTO_CLOSE_MS)
    }
  }

  private finalized = false

  private finalizeInBackground(): void {
    Promise.resolve(this.opts.onFinalize())
      .then(() => {
        this.finalized = true
        this.attachHandoff()
      })
      .catch(() => {})
  }

  private buildEmailCard(capture: { onSubmit: (email: string) => Promise<boolean> }): HTMLDivElement {
    const m = this.i18n.success
    const card = document.createElement('div')
    card.className = 'mtb-chat-email-card'

    const row = document.createElement('div')
    row.className = 'mtb-chat-email-row'

    const field = document.createElement('div')
    field.className = 'mtb-chat-email-field'
    const input = document.createElement('input')
    input.className = 'mtb-chat-email-input'
    input.type = 'email'
    input.placeholder = m.email_cta
    field.appendChild(input)

    const btn = document.createElement('button')
    btn.className = 'mtb-chat-email-submit'
    btn.type = 'button'
    btn.textContent = m.notify
    btn.disabled = true

    const submitEmail = async () => {
      const email = input.value.trim()
      if (!email) return
      btn.disabled = true
      input.disabled = true
      const saved = await capture.onSubmit(email)
      if (saved) {
        const note = document.createElement('div')
        note.className = 'mtb-chat-email-note'
        note.textContent = m.email_saved
        card.replaceChildren(note)
        this.autoCloseTimer = setTimeout(() => this.destroy(), AUTO_CLOSE_MS)
        return
      }
      input.disabled = false
      btn.disabled = false
      const error = card.querySelector('.mtb-chat-email-error') ?? document.createElement('div')
      error.className = 'mtb-chat-email-error'
      error.textContent = m.email_error
      card.appendChild(error)
    }

    input.addEventListener('input', () => { btn.disabled = !input.value.trim() })
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && input.value.trim()) void submitEmail()
    })
    btn.addEventListener('click', () => void submitEmail())

    row.appendChild(field)
    row.appendChild(btn)
    card.appendChild(row)
    return card
  }

  private appendUserBubble(text: string): void {
    const bubble = document.createElement('div')
    bubble.className = 'mtb-chat-bubble mtb-chat-bubble-user'
    bubble.textContent = text
    this.messagesEl.appendChild(bubble)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
    this.inputEl.value = ''
    this.sendBtn.disabled = true
  }

  private streamingBubbleEl: HTMLDivElement | null = null

  private startStreamingBubble(): void {
    const row = document.createElement('div')
    row.className = 'mtb-chat-ai-row'
    row.innerHTML = `<div class="mtb-chat-avatar">${BRAND_ICON}</div><div class="mtb-chat-bubble mtb-chat-bubble-ai"></div>`
    this.messagesEl.appendChild(row)
    this.streamingBubbleEl = row.querySelector('.mtb-chat-bubble-ai')!
  }

  private appendStreamDelta(text: string): void {
    if (!this.streamingBubbleEl) return
    this.streamingBubbleEl.textContent = (this.streamingBubbleEl.textContent ?? '') + text
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private endStreamingBubble(): void {
    this.streamingBubbleEl = null
  }

  private appendAiBubble(text: string): void {
    const row = document.createElement('div')
    row.className = 'mtb-chat-ai-row'
    row.innerHTML = `<div class="mtb-chat-avatar">${BRAND_ICON}</div><div class="mtb-chat-bubble mtb-chat-bubble-ai"></div>`
    row.querySelector('.mtb-chat-bubble-ai')!.textContent = text
    this.messagesEl.appendChild(row)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private renderSuggestions(suggestions: string[] | undefined): void {
    this.clearSuggestions()
    if (!suggestions?.length) return

    const row = document.createElement('div')
    row.className = 'mtb-chat-suggestions'
    for (const suggestion of suggestions) {
      const pill = document.createElement('button')
      pill.className = 'mtb-chat-sg'
      pill.type = 'button'
      pill.textContent = suggestion
      pill.addEventListener('click', () => {
        this.inputEl.value = suggestion
        this.sendBtn.disabled = false
        this.inputEl.focus({ preventScroll: true })
      })
      row.appendChild(pill)
    }
    this.messagesEl.appendChild(row)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private clearSuggestions(): void {
    this.messagesEl.querySelector('.mtb-chat-suggestions')?.remove()
  }

  private showThinking(): void {
    if (this.messagesEl.querySelector('.mtb-chat-thinking')) return
    const row = document.createElement('div')
    row.className = 'mtb-chat-ai-row mtb-chat-thinking'
    row.innerHTML = `<div class="mtb-chat-avatar">${BRAND_ICON}</div><div class="mtb-chat-dots"><span></span><span></span><span></span></div>`
    this.messagesEl.appendChild(row)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private removeThinking(): void {
    this.messagesEl.querySelector('.mtb-chat-thinking')?.remove()
  }

  private showRetryableError(text: string, onRetry: () => void): void {
    this.clearError()
    const row = document.createElement('div')
    row.className = 'mtb-chat-error-row'
    const msg = document.createElement('span')
    msg.className = 'mtb-chat-error-text'
    msg.textContent = text
    const retry = document.createElement('button')
    retry.className = 'mtb-chat-error-retry'
    retry.type = 'button'
    retry.textContent = this.i18n.clarify.retry
    retry.addEventListener('click', onRetry)
    row.appendChild(msg)
    row.appendChild(retry)
    this.messagesEl.appendChild(row)
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private clearError(): void {
    this.messagesEl.querySelectorAll('.mtb-chat-error-row').forEach(el => el.remove())
  }

  private showSkip(): void {
    if (this.actionsEl.querySelector('.mtb-chat-skip')) return
    const skip = document.createElement('button')
    skip.className = 'mtb-chat-skip'
    skip.type = 'button'
    skip.title = this.i18n.clarify.skip
    skip.textContent = this.i18n.clarify.skip_short
    skip.addEventListener('click', () => this.skipAndSend())
    this.actionsEl.insertBefore(skip, this.sendBtn)
  }

  private skipAndSend(): void {
    this.hideSkip()
    this.state = 'done'
    this.setComposerDisabled(true)
    this.renderSuccess()
    this.finalizeInBackground()
  }

  private hideSkip(): void {
    this.actionsEl?.querySelector('.mtb-chat-skip')?.remove()
  }

  private hideCapture(): void {
    this.actionsEl.querySelector('.mtb-chat-screenshot')?.remove()
    this.actionsEl.querySelector('.mtb-chat-attachment')?.remove()
  }

  private setComposerDisabled(disabled: boolean): void {
    this.inputEl.disabled = disabled
    this.sendBtn.disabled = disabled
    this.composerEl.classList.toggle('mtb-chat-composer-disabled', disabled)
  }

  private positionCard(x: number, y: number, targetRect: TargetRect | undefined, tabPosition: 'left' | 'right'): void {
    const frame = measureViewportFrame(tabPosition)
    const { vw, vh, minLeft, maxRight } = frame
    const margin = VIEWPORT_MARGIN
    const gap = 8
    const cardW = panelWidth(CARD_WIDTH, frame)
    const measured = this.el.offsetHeight || 280
    const cardH = measured + 80

    let left: number
    let top: number

    const anchorIsInformative =
      targetRect && targetRect.width < vw * 0.6 && targetRect.height < vh * 0.6

    if (targetRect && anchorIsInformative) {
      left = targetRect.left
      top = targetRect.bottom + gap
      if (top + cardH > vh - margin) top = targetRect.top - cardH - gap
      if (top < margin) top = Math.min(targetRect.bottom + gap, vh - cardH - margin)
    } else {
      left = x + 12
      top = y + 12
    }

    if (left + cardW > maxRight) left = maxRight - cardW
    if (left < minLeft) left = minLeft
    if (top < margin) top = margin

    if (top + cardH > vh - margin) top = vh - cardH - margin
    if (top < margin) top = margin

    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
    this.el.style.maxHeight = `${vh - top - margin}px`
  }

  submit(text: string): void {
    void this.sendMessage(text)
  }

  /** Which submission this card holds — null while the reporter is still typing. */
  sessionId(): string | null {
    return this.session?.id ?? null
  }

  destroy(): void {
    this.clarifyAbort?.abort()
    if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer)
    window.removeEventListener('keydown', this.handleEscape)
    this.sheet.release()
    this.focusTrap.release()
    this.el.remove()
    this.focusTrap.restoreFocus()
  }
}
