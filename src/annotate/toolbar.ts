import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'

export type ToolbarMode = 'markup' | 'record'

const FADE_HOVER_DELAY_MS = 500

export class AnnotationToolbar {
  private el: HTMLDivElement
  private hintEl!: HTMLSpanElement
  private markupBtn!: HTMLButtonElement
  private recordBtn!: HTMLButtonElement
  private messages: I18nMessages
  private currentMode: ToolbarMode = 'markup'

  private fadeTimer: ReturnType<typeof setTimeout> | null = null
  private faded = false
  private pointerInside = false
  private handleDocMouseMove = (e: MouseEvent): void => {
    const rect = this.el.getBoundingClientRect()
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom

    if (inside && !this.pointerInside) {
      if (this.faded) {
        this.restoreToolbar()
      } else {
        this.startFadeTimer()
      }
    } else if (!inside && this.pointerInside) {
      this.clearFadeTimer()
    }
    this.pointerInside = inside
  }

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    onExit: () => void,
    onModeChange?: (mode: ToolbarMode) => void,
  ) {
    this.messages = messages

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-toolbar')
    this.el.innerHTML = this.buildHTML(messages)
    shadow.append(this.el)

    this.hintEl = this.el.querySelector('.mtb-toolbar-hint')!
    this.markupBtn = this.el.querySelector('.mtb-toolbar-mode-markup')!
    this.recordBtn = this.el.querySelector('.mtb-toolbar-mode-record')!

    this.markupBtn.addEventListener('click', () => {
      this.setMode('markup')
      onModeChange?.('markup')
    })
    this.recordBtn.addEventListener('click', () => {
      this.setMode('record')
      onModeChange?.('record')
    })
    this.el.querySelector('.mtb-exit-btn')!.addEventListener('click', onExit)
    this.el.addEventListener('click', () => this.clearFadeTimer())

    document.addEventListener('mousemove', this.handleDocMouseMove)
  }

  private startFadeTimer(): void {
    this.clearFadeTimer()
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null
      this.faded = true
      this.el.classList.add('mtb-toolbar-faded')
    }, FADE_HOVER_DELAY_MS)
  }

  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer)
      this.fadeTimer = null
    }
  }

  private restoreToolbar(): void {
    this.faded = false
    this.el.classList.remove('mtb-toolbar-faded')
  }

  private buildHTML(m: I18nMessages): string {
    return `
      <div class="mtb-toolbar-modes">
        <button class="mtb-toolbar-mode-btn mtb-toolbar-mode-markup active">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg>${m.toolbar.markup}
        </button>
        <button class="mtb-toolbar-mode-btn mtb-toolbar-mode-record">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/></svg>${m.toolbar.record}
        </button>
      </div>
      <span class="mtb-toolbar-hint">${m.toolbar.hint}</span>
      <span class="mtb-toolbar-sep"></span>
      <button class="mtb-exit-btn">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>${m.toolbar.exit}
      </button>
    `
  }

  setMode(mode: ToolbarMode): void {
    this.currentMode = mode
    if (mode === 'markup') {
      this.markupBtn.classList.add('active')
      this.recordBtn.classList.remove('active')
      this.hintEl.textContent = this.messages.toolbar.hint
    } else {
      this.markupBtn.classList.remove('active')
      this.recordBtn.classList.add('active')
      this.hintEl.textContent = this.messages.toolbar.hintRecord
    }
  }

  getMode(): ToolbarMode {
    return this.currentMode
  }

  destroy(): void {
    this.clearFadeTimer()
    document.removeEventListener('mousemove', this.handleDocMouseMove)
    this.el.remove()
  }
}
