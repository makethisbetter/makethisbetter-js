import type { ShadowContainer } from './shadow'
import type { I18nMessages } from '../i18n'

export class FeedbackTab {
  private el: HTMLButtonElement
  private onClick: () => void
  private idleLabel: string
  private activeLabel: string
  private customText?: string
  private active = false

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    position: 'left' | 'right',
    onClick: () => void,
    customText?: string,
  ) {
    this.onClick = onClick
    this.customText = customText
    this.el = shadow.el<HTMLButtonElement>('button', 'mtb-tab')
    if (position === 'left') this.el.classList.add('left')
    this.idleLabel = customText ?? messages.tab
    this.activeLabel = messages.toolbar.exit
    this.setLabel(this.idleLabel)
    this.el.addEventListener('click', onClick)
    shadow.append(this.el)
  }

  private setLabel(label: string): void {
    this.el.textContent = label
    this.el.setAttribute('aria-label', label)
  }

  setMessages(messages: I18nMessages): void {
    this.idleLabel = this.customText ?? messages.tab
    this.activeLabel = messages.toolbar.exit
    this.setLabel(this.active ? this.activeLabel : this.idleLabel)
  }

  setActive(active: boolean): void {
    this.active = active
    this.el.classList.toggle('active', active)
    this.setLabel(active ? this.activeLabel : this.idleLabel)
  }

  destroy(): void {
    this.el.removeEventListener('click', this.onClick)
    this.el.remove()
  }
}
