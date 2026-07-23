import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { TargetRect } from '../types'
import { escapeHtml } from '../context/dom-utils'

interface PopupOptions {
  targetName: string
  x: number
  y: number
  targetRect?: TargetRect
  onSubmit: (description: string) => void
  onClose: () => void
  onMyFeedback?: () => void
  messages: I18nMessages
  position?: 'left' | 'right'
}

export class CommentPopup {
  private el: HTMLDivElement
  private textarea!: HTMLTextAreaElement
  private submitBtn!: HTMLButtonElement
  private errorEl!: HTMLDivElement
  private onSubmit: (description: string) => void
  private onClose: () => void
  private submitLabel: string
  private loading = false
  private messages: I18nMessages
  private selectedQuickOption: string | null = null

  constructor(shadow: ShadowContainer, opts: PopupOptions) {
    this.onSubmit = opts.onSubmit
    this.onClose = opts.onClose
    this.submitLabel = opts.messages.popup.submit
    this.messages = opts.messages

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-popup')
    this.el.innerHTML = this.buildHTML(opts)
    shadow.append(this.el)

    this.textarea = this.el.querySelector('.mtb-textarea')!
    this.submitBtn = this.el.querySelector('.mtb-submit-btn')!

    this.positionPopup(opts.x, opts.y, opts.targetRect, opts.position ?? 'right')
    this.bindEvents(opts.messages)
    if (opts.onMyFeedback) {
      this.el.querySelector('.mtb-my-feedback')!.addEventListener('click', opts.onMyFeedback)
    }
    this.textarea.focus()
  }

  private buildHTML(opts: PopupOptions): string {
    const m = opts.messages
    const quickOpts = m.popup.quickOptions
      .map(
        o => `
        <button class="mtb-quick-option" data-quick="${escapeHtml(o.label)}">
          <span class="mtb-quick-option-emoji">${o.emoji}</span>
          <span>${escapeHtml(o.label)}</span>
        </button>`,
      )
      .join('')

    return `
      <div class="mtb-popup-header">
        <div class="mtb-popup-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <span class="mtb-popup-title">${m.popup.about} "${escapeHtml(opts.targetName)}"</span>
        <button class="mtb-popup-close" aria-label="Close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="mtb-popup-body">
        <div class="mtb-quick-options">
          ${quickOpts}
        </div>
        <div class="mtb-textarea-wrap">
          <textarea class="mtb-textarea" placeholder="${escapeHtml(m.popup.placeholder)}"></textarea>
        </div>
        <div class="mtb-popup-error" role="alert"></div>
        <div class="mtb-popup-actions">
          <button class="mtb-cancel-btn" type="button">${escapeHtml(m.popup.cancel)}</button>
          <button class="mtb-submit-btn" type="button" disabled>${escapeHtml(m.popup.submit)}</button>
        </div>
        ${opts.onMyFeedback ? `<button class="mtb-my-feedback" type="button">${escapeHtml(m.popup.my_feedback)}</button>` : ''}
      </div>
    `
  }



  private positionPopup(x: number, y: number, targetRect: TargetRect | undefined, tabPosition: 'left' | 'right'): void {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 12
    const gap = 8
    const tabWidth = 32
    const popupW = Math.min(320, vw - 2 * margin - tabWidth)
    const popupH = this.el.offsetHeight || 260
    const minLeft = margin + (tabPosition === 'left' ? tabWidth : 0)
    const maxRight = vw - margin - (tabPosition === 'right' ? tabWidth : 0)

    let left: number
    let top: number

    if (targetRect) {
      left = targetRect.left
      top = targetRect.bottom + gap

      if (top + popupH > vh - margin) {
        top = targetRect.top - popupH - gap
      }
      if (top < margin) {
        top = Math.min(targetRect.bottom + gap, vh - popupH - margin)
      }
    } else {
      left = x + 12
      top = y + 12
    }

    if (left + popupW > maxRight) {
      left = maxRight - popupW
    }
    if (left < minLeft) left = minLeft
    if (top < margin) top = margin

    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
    this.el.style.maxHeight = `${vh - top - margin}px`
  }

  private bindEvents(messages: I18nMessages): void {
    this.el.querySelector('.mtb-popup-close')!.addEventListener('click', () => this.onClose())
    this.el.querySelector('.mtb-cancel-btn')!.addEventListener('click', () => this.onClose())
    this.errorEl = this.el.querySelector('.mtb-popup-error')!

    this.el.querySelectorAll('.mtb-quick-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const label = (btn as HTMLElement).dataset['quick'] ?? ''

        if (this.textarea.value.trim().length === 0) {
          this.textarea.value = label
          this.updateSubmitState()
          this.submit()
          return
        }

        this.selectedQuickOption = label
        this.el.querySelectorAll('.mtb-quick-option').forEach(option => {
          option.classList.toggle('selected', option === btn)
        })
      })
    })

    this.textarea.addEventListener('input', () => this.updateSubmitState())

    this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.submit()
      }
    })

    this.submitBtn.addEventListener('click', () => this.submit())
  }

  private updateSubmitState(): void {
    const hasText = this.textarea.value.trim().length > 0
    this.submitBtn.classList.toggle('ready', hasText && !this.loading)
    this.submitBtn.disabled = !hasText || this.loading
    this.errorEl.hidden = true
    this.errorEl.textContent = ''
  }

  private submit(): void {
    const text = this.textarea.value.trim()
    if (!text || this.loading) return
    const description = this.selectedQuickOption ? `[${this.selectedQuickOption}] ${text}` : text
    this.onSubmit(description)
  }

  setLoading(loading: boolean): void {
    this.loading = loading
    if (loading) {
      this.submitBtn.classList.add('loading')
      this.submitBtn.innerHTML = `<span class="mtb-dot"></span><span class="mtb-dot"></span><span class="mtb-dot"></span>`
      this.textarea.disabled = true
    } else {
      this.submitBtn.classList.remove('loading')
      this.submitBtn.textContent = this.submitLabel
      this.textarea.disabled = false
    }
    this.updateSubmitState()
  }

  setError(message: string): void {
    this.errorEl.textContent = message
    this.errorEl.hidden = false
  }

  releaseElement(): HTMLDivElement {
    return this.el
  }

  destroy(): void {
    this.el.remove()
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
