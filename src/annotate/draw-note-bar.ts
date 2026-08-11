import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { escapeHtml, isImeConfirmKeydown } from '../context/dom-utils'
import { SheetLayout } from '../popup/sheet'

interface DrawNoteBarOptions {
  messages: I18nMessages
  onUndo: () => void
  onRedo: () => void
  onCancel: () => void
  onSubmit: (note: string) => void
  // Fired on every keystroke; the owner uses it to defer heavy capture work
  // until the reporter pauses.
  onActivity?: () => void
}

export class DrawNoteBar {
  private el: HTMLDivElement
  private sheet: SheetLayout
  private input!: HTMLInputElement
  private undoBtn!: HTMLButtonElement
  private redoBtn!: HTMLButtonElement
  private submitBtn!: HTMLButtonElement
  private onSubmit: (note: string) => void
  private submitLabel: string
  private messages: I18nMessages

  constructor(shadow: ShadowContainer, opts: DrawNoteBarOptions) {
    this.onSubmit = opts.onSubmit
    this.submitLabel = opts.messages.draw.submit
    this.messages = opts.messages

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-draw-bar')
    this.el.innerHTML = this.buildHTML(opts.messages)
    shadow.append(this.el)
    // The bar carries a text field and sits flush to the bottom on a phone,
    // which is exactly where the keyboard lands.
    this.sheet = new SheetLayout(this.el)
    this.sheet.apply()

    this.input = this.el.querySelector('.mtb-draw-input')!
    this.undoBtn = this.el.querySelector('.mtb-draw-undo')!
    this.redoBtn = this.el.querySelector('.mtb-draw-redo')!
    this.submitBtn = this.el.querySelector('.mtb-draw-submit')!

    this.undoBtn.addEventListener('click', opts.onUndo)
    this.redoBtn.addEventListener('click', opts.onRedo)
    this.el.querySelector('.mtb-draw-cancel')!.addEventListener('click', opts.onCancel)
    this.submitBtn.addEventListener('click', () => this.submit())
    if (opts.onActivity) this.input.addEventListener('input', opts.onActivity)
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (isImeConfirmKeydown(e)) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.submit()
      }
    })

    this.input.focus({ preventScroll: true })
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
      <label class="mtb-draw-shot" title="${escapeHtml(m.popup.screenshot_locked_hint)}">
        <input type="checkbox" checked disabled><span>${escapeHtml(m.popup.screenshot_short)}</span>
      </label>
      <span class="mtb-draw-sep"></span>
      <button class="mtb-draw-cancel" type="button">${escapeHtml(m.draw.cancel)}</button>
      <button class="mtb-draw-submit" type="button">${escapeHtml(m.draw.submit)}</button>
    `
  }

  setLoading(loading: boolean): void {
    if (loading) {
      this.submitBtn.disabled = true
      this.submitBtn.classList.add('mtb-btn-loading')
      this.submitBtn.textContent = this.messages.popup.sending
      this.input.disabled = true
    } else {
      this.submitBtn.disabled = false
      this.submitBtn.classList.remove('mtb-btn-loading')
      this.submitBtn.textContent = this.submitLabel
      this.input.disabled = false
    }
  }

  setUndoRedo(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo
    this.redoBtn.disabled = !canRedo
  }

  private submit(): void {
    this.onSubmit(this.input.value.trim())
  }

  destroy(): void {
    this.sheet.release()
    this.el.remove()
  }
}

