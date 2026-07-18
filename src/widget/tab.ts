import type { ShadowContainer } from './shadow'
import type { I18nMessages } from '../i18n'

export class FeedbackTab {
  private el: HTMLButtonElement
  private onClick: () => void

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    position: 'left' | 'right',
    onClick: () => void,
    customText?: string,
  ) {
    this.onClick = onClick
    this.el = shadow.el<HTMLButtonElement>('button', 'mtb-tab')
    if (position === 'left') this.el.classList.add('left')
    const label = customText ?? messages.tab
    this.el.textContent = label
    this.el.setAttribute('aria-label', label)
    this.el.addEventListener('click', onClick)
    shadow.append(this.el)
  }

  setActive(active: boolean): void {
    this.el.classList.toggle('active', active)
  }

  destroy(): void {
    this.el.removeEventListener('click', this.onClick)
    this.el.remove()
  }
}
