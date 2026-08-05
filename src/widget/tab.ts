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
    customColor?: string,
  ) {
    this.onClick = onClick
    this.customText = customText
    this.el = shadow.el<HTMLButtonElement>('button', 'mtb-tab')
    if (position === 'left') this.el.classList.add('left')
    this.setCustomColor(customColor)
    this.idleLabel = customText ?? messages.tab
    this.activeLabel = messages.toolbar.exit
    this.setLabel(this.idleLabel)
    this.el.addEventListener('click', onClick)
    shadow.append(this.el)
  }

  private setCustomColor(color?: string): void {
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return

    const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
    const darken = (amount: number): string => {
      const values = channels.map((channel) => Math.round(channel * (1 - amount)))
      return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`
    }

    this.el.style.setProperty('--mtb-tab-bg', color.toLowerCase())
    this.el.style.setProperty('--mtb-tab-hover-bg', darken(0.15))
    this.el.style.setProperty('--mtb-tab-active-bg', darken(0.28))
    this.el.style.setProperty('--mtb-tab-shadow-color', channels.join(', '))
    this.el.style.setProperty('--mtb-tab-fg', this.foregroundFor(channels))
  }

  private foregroundFor(channels: number[]): string {
    const linear = channels.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    return luminance > 0.179 ? '#191a1c' : '#fff'
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
