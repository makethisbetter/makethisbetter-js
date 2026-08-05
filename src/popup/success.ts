import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { escapeHtml } from '../context/dom-utils'
import { trapFocus, type FocusTrap } from './focus-trap'

const SUCCESS_AUTO_CLOSE_MS = 5000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface SuccessCardOptions {
  skipFollowup?: boolean
  emailCapture?: {
    onSubmit: (email: string) => Promise<boolean>
  }
}

export class SuccessCard {
  private el: HTMLDivElement
  private messages: I18nMessages
  private focusTrap: FocusTrap
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(shadow: ShadowContainer, messages: I18nMessages, onClose: () => void, onViewFeedback?: () => void, options?: SuccessCardOptions) {
    this.messages = messages
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-success')
    this.el.style.right = '20px'
    this.el.style.bottom = '20px'

    const title = options?.skipFollowup ? messages.success.title_no_ai : messages.success.title
    const msg = options?.skipFollowup ? messages.success.message_no_ai : messages.success.message

    // The card interrupts whatever the reporter was doing on the host page, so
    // a screen reader needs to hear it announced as a dialog, not stumble on
    // loose text.
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.setAttribute('aria-label', title)

    const viewLink = onViewFeedback
      ? `<button class="mtb-view-feedback-link">${escapeHtml(messages.success.view_feedback)} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>`
      : ''

    const emailCapture = options?.emailCapture
      ? `
      <div class="mtb-email-capture">
        <div class="mtb-email-prompt">${escapeHtml(messages.success.email_prompt)}</div>
        <div class="mtb-email-row">
          <input class="mtb-email-input" type="email" placeholder="${escapeHtml(messages.success.email_placeholder)}">
          <button class="mtb-email-submit">${escapeHtml(messages.success.email_submit)}</button>
        </div>
        <div class="mtb-email-error" hidden>${escapeHtml(messages.success.email_error)}</div>
      </div>`
      : ''

    this.el.innerHTML = `
      <div class="mtb-success-icon">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="var(--mtb-brand-primary)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div class="mtb-success-title">${escapeHtml(title)}</div>
      <div class="mtb-success-msg">${escapeHtml(msg)}</div>
      ${emailCapture}
      ${viewLink}
      <button class="mtb-close-link">${escapeHtml(messages.success.close)}</button>
    `
    shadow.append(this.el)
    this.focusTrap = trapFocus(this.el)
    this.el.querySelector('.mtb-close-link')!.addEventListener('click', onClose)

    if (onViewFeedback) {
      this.el.querySelector('.mtb-view-feedback-link')!.addEventListener('click', onViewFeedback)
    }

    if (options?.emailCapture) {
      // No auto-close while the email form is up: the reporter may be mid-
      // decision about leaving their address, and yanking the card away would
      // decide for them.
      this.bindEmailCapture(options.emailCapture.onSubmit, onClose)
    } else {
      this.autoCloseTimer = setTimeout(() => onClose(), SUCCESS_AUTO_CLOSE_MS)
    }
  }

  private bindEmailCapture(onSubmit: (email: string) => Promise<boolean>, onClose: () => void): void {
    const input = this.el.querySelector<HTMLInputElement>('.mtb-email-input')!
    const submit = this.el.querySelector<HTMLButtonElement>('.mtb-email-submit')!
    const error = this.el.querySelector<HTMLDivElement>('.mtb-email-error')!

    const handle = async () => {
      const email = input.value.trim()
      if (!EMAIL_PATTERN.test(email)) {
        input.classList.add('mtb-email-invalid')
        return
      }
      input.classList.remove('mtb-email-invalid')
      error.hidden = true
      submit.disabled = true

      const saved = await onSubmit(email)
      if (saved) {
        this.el.querySelector('.mtb-email-capture')!.innerHTML =
          `<div class="mtb-email-saved">${escapeHtml(this.messages.success.email_saved)}</div>`
        // The form has served its purpose once the address is saved; from here
        // the card behaves like the no-capture variant and sees itself out.
        this.autoCloseTimer = setTimeout(() => onClose(), SUCCESS_AUTO_CLOSE_MS)
      } else {
        error.hidden = false
        submit.disabled = false
      }
    }

    submit.addEventListener('click', handle)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handle()
    })
  }

  destroy(): void {
    // onClose closes whichever card is current when the timer fires: a card
    // dismissed early and replaced by a new submission would otherwise have
    // its leftover timer kill the successor at the original deadline.
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer)
      this.autoCloseTimer = null
    }
    this.focusTrap.release()
    this.el.remove()
    this.focusTrap.restoreFocus()
  }
}
