import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { trapFocus, type FocusTrap } from './focus-trap'

const AUTO_CLOSE_MS = 5000

const CHECK_ICON = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M8.1 14.6L3.8 10.3l1.5-1.5 2.8 2.8 6.6-6.6 1.5 1.5z"/></svg>'

export interface ReceiptCardOptions {
  skipFollowup?: boolean
  onViewFeedback?: () => void
}

/**
 * The standalone receipt for a submission whose chat card is already gone —
 * today that is one path: a background finalize failed, its failure card was
 * dismissed by the retry, and the retry then succeeded. Renders with the chat
 * card's own receipt classes so the two ways of saying "sent" stay one design.
 */
export class ReceiptCard {
  private el: HTMLDivElement
  private focusTrap: FocusTrap
  private autoCloseTimer: ReturnType<typeof setTimeout>

  constructor(shadow: ShadowContainer, messages: I18nMessages, onClose: () => void, options?: ReceiptCardOptions) {
    const m = messages.success
    const title = options?.skipFollowup ? m.title_no_ai : m.title

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-chat mtb-chat-receipt')
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.setAttribute('aria-label', title)

    const view = document.createElement('div')
    view.className = 'mtb-chat-success mtb-chat-success-simple'

    const icon = document.createElement('div')
    icon.className = 'mtb-chat-success-icon'
    icon.innerHTML = CHECK_ICON
    view.appendChild(icon)

    const titleEl = document.createElement('div')
    titleEl.className = 'mtb-chat-success-title'
    titleEl.textContent = title
    view.appendChild(titleEl)

    if (options?.onViewFeedback) {
      const link = document.createElement('a')
      link.className = 'mtb-chat-success-link'
      link.href = '#'
      link.textContent = m.track_feedback
      link.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault()
        options.onViewFeedback!()
      })
      view.appendChild(link)
    }

    this.el.appendChild(view)
    shadow.append(this.el)
    this.focusTrap = trapFocus(this.el)
    this.autoCloseTimer = setTimeout(onClose, AUTO_CLOSE_MS)
  }

  destroy(): void {
    clearTimeout(this.autoCloseTimer)
    this.focusTrap.release()
    this.el.remove()
    this.focusTrap.restoreFocus()
  }
}
