import type { ShadowContainer } from './shadow'
import type { I18nMessages } from '../i18n'
import { BRAND_COLOR } from '../styles'

export class PetEntry {
  private el: HTMLDivElement
  private bubble: HTMLDivElement
  private onClick: () => void

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    onClick: () => void,
  ) {
    this.onClick = onClick

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-pet')
    this.el.innerHTML = this.buildSVG()
    this.el.setAttribute('role', 'button')
    this.el.setAttribute('aria-label', messages.tab)
    this.el.tabIndex = 0

    this.bubble = shadow.el<HTMLDivElement>('div', 'mtb-pet-bubble')
    this.bubble.textContent = messages.pet.bubble
    this.el.appendChild(this.bubble)

    this.el.addEventListener('click', this.onClick)
    this.el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.onClick()
      }
    })

    shadow.append(this.el)
  }

  private buildSVG(): string {
    return `<svg class="mtb-pet-svg" width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="28" r="16" fill="${BRAND_COLOR}"/>
      <circle cx="24" cy="28" r="14" fill="#10b981"/>
      <circle cx="19" cy="25" r="3" fill="#fff"/>
      <circle cx="29" cy="25" r="3" fill="#fff"/>
      <circle cx="20" cy="24.5" r="1.5" fill="#064e3b"/>
      <circle cx="30" cy="24.5" r="1.5" fill="#064e3b"/>
      <ellipse cx="19.5" cy="23.5" rx="0.8" ry="0.6" fill="#fff" opacity="0.7"/>
      <ellipse cx="29.5" cy="23.5" rx="0.8" ry="0.6" fill="#fff" opacity="0.7"/>
      <path d="M20 31 Q24 34 28 31" stroke="#064e3b" stroke-width="1.5" stroke-linecap="round" fill="none"/>
      <circle cx="15" cy="30" r="2.5" fill="${BRAND_COLOR}" opacity="0.4"/>
      <circle cx="33" cy="30" r="2.5" fill="${BRAND_COLOR}" opacity="0.4"/>
      <path d="M14 17 Q16 12 20 15" stroke="#10b981" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M34 17 Q32 12 28 15" stroke="#10b981" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`
  }

  setActive(active: boolean): void {
    this.el.classList.toggle('active', active)
    if (active) {
      this.bubble.classList.add('hidden')
    }
  }

  destroy(): void {
    this.el.removeEventListener('click', this.onClick)
    this.el.remove()
  }
}
