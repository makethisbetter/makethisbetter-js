import type { ShadowContainer } from './shadow'
import type { I18nMessages } from '../i18n'

const FRUSTRATION_DISMISS_MS = 8000

export class FrustrationPromptCard {
  private el: HTMLDivElement

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    handlers: { onTell: () => void; onDismiss: () => void },
  ) {
    this.el = shadow.el<HTMLDivElement>('div', 'mtb-frustration-prompt')
    this.el.innerHTML = `
      <div class="mtb-frustration-icon">&#9888;&#65039;</div>
      <span class="mtb-frustration-text">${messages.frustration.prompt}</span>
      <div class="mtb-frustration-actions">
        <button class="mtb-frustration-tell">${messages.frustration.action}</button>
        <button class="mtb-frustration-dismiss">${messages.frustration.dismiss}</button>
      </div>
    `

    this.el.querySelector('.mtb-frustration-tell')!.addEventListener('click', handlers.onTell)
    this.el.querySelector('.mtb-frustration-dismiss')!.addEventListener('click', handlers.onDismiss)

    shadow.append(this.el)
    setTimeout(handlers.onDismiss, FRUSTRATION_DISMISS_MS)
  }

  destroy(): void {
    this.el.remove()
  }
}
