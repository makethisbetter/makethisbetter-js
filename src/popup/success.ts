import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { BRAND_COLOR } from '../styles'

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

  constructor(shadow: ShadowContainer, messages: I18nMessages, onClose: () => void, onViewFeedback?: () => void, options?: SuccessCardOptions) {
    this.messages = messages
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-success')
    this.el.style.right = '20px'
    this.el.style.bottom = '20px'

    const title = options?.skipFollowup ? messages.success.title_no_ai : messages.success.title
    const msg = options?.skipFollowup ? messages.success.message_no_ai : messages.success.message

    const viewLink = onViewFeedback
      ? `<button class="mtb-view-feedback-link">${messages.success.view_feedback} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>`
      : ''

    const emailCapture = options?.emailCapture
      ? `
      <div class="mtb-email-capture">
        <div class="mtb-email-prompt">${messages.success.email_prompt}</div>
        <div class="mtb-email-row">
          <input class="mtb-email-input" type="email" placeholder="${messages.success.email_placeholder}">
          <button class="mtb-email-submit">${messages.success.email_submit}</button>
        </div>
        <div class="mtb-email-error" hidden>${messages.success.email_error}</div>
      </div>`
      : ''

    this.el.innerHTML = `
      <div class="mtb-success-icon">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="${BRAND_COLOR}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div class="mtb-success-title">${title}</div>
      <div class="mtb-success-msg">${msg}</div>
      ${emailCapture}
      ${viewLink}
      <button class="mtb-close-link">${messages.success.close}</button>
    `
    shadow.append(this.el)
    this.el.querySelector('.mtb-close-link')!.addEventListener('click', onClose)

    if (onViewFeedback) {
      this.el.querySelector('.mtb-view-feedback-link')!.addEventListener('click', onViewFeedback)
    }

    if (options?.emailCapture) {
      this.bindEmailCapture(options.emailCapture.onSubmit)
    } else {
      setTimeout(() => onClose(), SUCCESS_AUTO_CLOSE_MS)
    }
  }

  private bindEmailCapture(onSubmit: (email: string) => Promise<boolean>): void {
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
          `<div class="mtb-email-saved">${this.messages.success.email_saved}</div>`
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
    this.el.remove()
  }
}
