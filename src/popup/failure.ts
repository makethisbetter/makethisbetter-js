import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { escapeHtml } from '../context/dom-utils'

export interface FailureCardOptions {
  onRetry?: () => void
  onClose: () => void
}

// Shown when a finalize the reporter can no longer see fails — they skipped the
// clarification, so the card that owns the inline retry footer is already gone.
// Without this the submission dies silently and they believe it was sent.
// Unlike the receipt this never auto-closes: it is the only surviving trace of
// the failure.
export class FailureCard {
  private el: HTMLDivElement

  constructor(shadow: ShadowContainer, messages: I18nMessages, options: FailureCardOptions) {
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-failure')
    this.el.style.right = '20px'
    this.el.style.bottom = '20px'
    this.el.setAttribute('role', 'alert')

    const retry = options.onRetry
      ? `<div class="mtb-failure-actions">
        <button class="mtb-clarify-retry mtb-failure-retry" type="button">${escapeHtml(messages.clarify.retry)}</button>
      </div>`
      : ''

    this.el.innerHTML = `
      <button class="mtb-failure-close" type="button" title="${escapeHtml(messages.success.close)}" aria-label="${escapeHtml(messages.success.close)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
      <div class="mtb-failure-icon">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <div class="mtb-failure-title">${escapeHtml(messages.error.submit)}</div>
      ${retry}
    `
    shadow.append(this.el)

    if (options.onRetry) {
      this.el.querySelector('.mtb-failure-retry')!.addEventListener('click', options.onRetry)
    }
    this.el.querySelector('.mtb-failure-close')!.addEventListener('click', options.onClose)
  }

  destroy(): void {
    this.el.remove()
  }
}
