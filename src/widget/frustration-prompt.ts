import type { ShadowContainer } from './shadow'
import type { I18nMessages } from '../i18n'
import { escapeHtml } from '../context/dom-utils'

const FRUSTRATION_DISMISS_MS = 8000

export interface FrustrationPromptHandlers {
  onTell: () => void
  // The reporter clicked Dismiss — a deliberate refusal.
  onDismiss: () => void
  // Nobody touched the card and it faded out on its own. Kept separate from
  // onDismiss because "did not notice" is not "said no": treating the two the
  // same suppressed every later prompt for the session.
  onAutoHide: () => void
}

export class FrustrationPromptCard {
  private el: HTMLDivElement
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    handlers: FrustrationPromptHandlers,
  ) {
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-frustration-prompt')
    this.el.innerHTML = `
      <div class="mtb-frustration-icon">&#9888;&#65039;</div>
      <span class="mtb-frustration-text">${escapeHtml(messages.frustration.prompt)}</span>
      <div class="mtb-frustration-actions">
        <button class="mtb-frustration-tell">${escapeHtml(messages.frustration.action)}</button>
        <button class="mtb-frustration-dismiss">${escapeHtml(messages.frustration.dismiss)}</button>
      </div>
    `

    this.el.querySelector('.mtb-frustration-tell')!.addEventListener('click', handlers.onTell)
    this.el.querySelector('.mtb-frustration-dismiss')!.addEventListener('click', handlers.onDismiss)

    shadow.append(this.el)
    this.autoHideTimer = setTimeout(handlers.onAutoHide, FRUSTRATION_DISMISS_MS)
  }

  destroy(): void {
    // Clearing matters on the engagement path too: without it, a card destroyed
    // by "Tell us" still fired its auto-hide 8s later.
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer)
      this.autoHideTimer = null
    }
    this.el.remove()
  }
}
