import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'

export class RecordControlBar {
  private el: HTMLDivElement
  private timerEl!: HTMLSpanElement
  private intervalId: ReturnType<typeof setInterval> | null = null
  private getDuration: () => number

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    getDuration: () => number,
    onStop: () => void,
  ) {
    this.getDuration = getDuration

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-record-bar')
    this.el.innerHTML = `
      <span class="mtb-record-dot"></span>
      <span class="mtb-record-timer">00:00</span>
      <button class="mtb-record-stop" type="button">${messages.record.stop}</button>
    `
    shadow.append(this.el)

    this.timerEl = this.el.querySelector('.mtb-record-timer')!
    this.el.querySelector('.mtb-record-stop')!.addEventListener('click', onStop)

    this.intervalId = setInterval(() => this.updateTimer(), 1000)
  }

  private updateTimer(): void {
    const secs = this.getDuration()
    const mm = String(Math.floor(secs / 60)).padStart(2, '0')
    const ss = String(secs % 60).padStart(2, '0')
    this.timerEl.textContent = `${mm}:${ss}`
  }

  destroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.el.remove()
  }
}
