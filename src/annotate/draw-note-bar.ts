import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { escapeHtml } from '../context/dom-utils'

interface DrawNoteBarOptions {
  messages: I18nMessages
  onUndo: () => void
  onRedo: () => void
  onCancel: () => void
  onSubmit: (note: string) => void
}

export class DrawNoteBar {
  private el: HTMLDivElement
  private input!: HTMLInputElement
  private undoBtn!: HTMLButtonElement
  private redoBtn!: HTMLButtonElement
  private submitBtn!: HTMLButtonElement
  private errorEl!: HTMLDivElement
  private onSubmit: (note: string) => void
  private submitLabel: string
  private loading = false

  constructor(shadow: ShadowContainer, opts: DrawNoteBarOptions) {
    this.onSubmit = opts.onSubmit
    this.submitLabel = opts.messages.draw.submit

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-draw-bar')
    this.el.innerHTML = this.buildHTML(opts.messages)
    shadow.append(this.el)

    this.input = this.el.querySelector('.mtb-draw-input')!
    this.undoBtn = this.el.querySelector('.mtb-draw-undo')!
    this.redoBtn = this.el.querySelector('.mtb-draw-redo')!
    this.submitBtn = this.el.querySelector('.mtb-draw-submit')!
    this.errorEl = this.el.querySelector('.mtb-draw-error')!

    this.undoBtn.addEventListener('click', opts.onUndo)
    this.redoBtn.addEventListener('click', opts.onRedo)
    this.el.querySelector('.mtb-draw-cancel')!.addEventListener('click', opts.onCancel)
    this.submitBtn.addEventListener('click', () => this.submit())
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.submit()
      }
    })

    this.input.focus()
  }

  private buildHTML(m: I18nMessages): string {
    return `
      <input class="mtb-draw-input" type="text" placeholder="${escapeHtml(m.draw.note_placeholder)}" />
      <button class="mtb-draw-icon-btn mtb-draw-undo" type="button" title="${escapeHtml(m.draw.undo)}" aria-label="${escapeHtml(m.draw.undo)}" disabled>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>
      </button>
      <button class="mtb-draw-icon-btn mtb-draw-redo" type="button" title="${escapeHtml(m.draw.redo)}" aria-label="${escapeHtml(m.draw.redo)}" disabled>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg>
      </button>
      <span class="mtb-draw-sep"></span>
      <button class="mtb-draw-cancel" type="button">${escapeHtml(m.draw.cancel)}</button>
      <button class="mtb-draw-submit" type="button">${escapeHtml(m.draw.submit)}</button>
      <div class="mtb-draw-error" role="alert" hidden></div>
    `
  }

  setUndoRedo(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo || this.loading
    this.redoBtn.disabled = !canRedo || this.loading
  }

  setLoading(loading: boolean): void {
    this.loading = loading
    this.input.disabled = loading
    this.submitBtn.disabled = loading
    this.undoBtn.disabled = loading || this.undoBtn.disabled
    this.redoBtn.disabled = loading || this.redoBtn.disabled
    if (loading) {
      this.submitBtn.classList.add('loading')
      this.submitBtn.innerHTML = `<span class="mtb-dot"></span><span class="mtb-dot"></span><span class="mtb-dot"></span>`
      this.errorEl.hidden = true
      this.errorEl.textContent = ''
    } else {
      this.submitBtn.classList.remove('loading')
      this.submitBtn.textContent = this.submitLabel
    }
  }

  setError(message: string): void {
    this.errorEl.textContent = message
    this.errorEl.hidden = false
  }

  private submit(): void {
    if (this.loading) return
    this.onSubmit(this.input.value.trim())
  }

  destroy(): void {
    this.el.remove()
  }
}

