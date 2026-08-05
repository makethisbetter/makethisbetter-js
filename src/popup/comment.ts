import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import type { TargetRect } from '../types'
import { escapeHtml, isImeConfirmKeydown } from '../context/dom-utils'
import { SheetLayout } from './sheet'
import { measureViewportFrame, panelWidth, VIEWPORT_MARGIN } from './position'
import { guardReplayClick } from './replay-click-guard'
import { isTouchPointer } from '../widget/pointer-kind'
import { trapFocus, type FocusTrap } from './focus-trap'

interface PopupOptions {
  targetName: string
  x: number
  y: number
  targetRect?: TargetRect
  onSubmit: (description: string, initiatingKeydown?: KeyboardEvent) => void
  onClose: () => void
  // Fired on every keystroke; the owner uses it to defer heavy capture work
  // until the reporter pauses.
  onActivity?: () => void
  onMyFeedback?: () => void
  // Every surface that reaches this popup attaches a screenshot, so a
  // disclosure row is always shown. Supplying this callback makes it a choice;
  // omitting it leaves the box checked and disabled — disclosure without a
  // choice, which is what the drawing surfaces need, since strokes are baked
  // onto the screenshot and a drawing without one has nothing to sit on.
  onScreenshotToggle?: (enabled: boolean) => void
  // Set when the note follows a recording. To the reporter that submission is
  // ONE thing — the recording, which naturally contains the page image — so
  // the row discloses the recording alone, locked, and no screenshot question
  // is asked. Takes precedence over onScreenshotToggle.
  recordingSeconds?: number
  // Current consent, not a default. The popup is remounted mid-session, so
  // rendering a hardcoded tick would let the box claim a screenshot is going
  // out after the reporter already turned it off.
  screenshotEnabled?: boolean
  messages: I18nMessages
  position?: 'left' | 'right'
}

export class CommentPopup {
  private el: HTMLDivElement
  private sheet: SheetLayout
  private focusTrap: FocusTrap
  private releaseGuard: (() => void) | null = null
  private textarea!: HTMLTextAreaElement
  private submitBtn!: HTMLButtonElement
  private onSubmit: (description: string, initiatingKeydown?: KeyboardEvent) => void
  private onClose: () => void
  private onActivity?: () => void
  private submitLabel: string
  private messages: I18nMessages
  private selectedQuickOption: string | null = null

  constructor(shadow: ShadowContainer, opts: PopupOptions) {
    this.onSubmit = opts.onSubmit
    this.onClose = opts.onClose
    this.onActivity = opts.onActivity
    this.submitLabel = opts.messages.popup.submit
    this.messages = opts.messages

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-popup')
    // The popup interrupts the host page under a dim overlay, so assistive
    // tech needs it announced as a dialog rather than discovered as loose text.
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-modal', 'true')
    this.el.setAttribute('aria-label', `${opts.messages.popup.about} "${opts.targetName}"`)
    this.el.innerHTML = this.buildHTML(opts)
    shadow.append(this.el)
    // Installed before the textarea autofocus below, so the trap remembers the
    // host-page element the reporter came from, not our own field.
    this.focusTrap = trapFocus(this.el)
    this.sheet = new SheetLayout(this.el)
    // The tap that opened this panel is replayed as a click once the panel is
    // already under the finger — on iOS it landed on the button row.
    if (isTouchPointer()) this.releaseGuard = guardReplayClick(this.el)

    this.textarea = this.el.querySelector('.mtb-textarea')!
    this.submitBtn = this.el.querySelector('.mtb-submit-btn')!

    this.positionPopup(opts.x, opts.y, opts.targetRect, opts.position ?? 'right')
    this.bindEvents(opts.messages)
    if (opts.onScreenshotToggle) {
      const box = this.el.querySelector<HTMLInputElement>('.mtb-screenshot-opt input')!
      box.addEventListener('change', () => opts.onScreenshotToggle!(box.checked))
    }
    if (opts.onMyFeedback) {
      this.el.querySelector('.mtb-my-feedback')!.addEventListener('click', opts.onMyFeedback)
    }
    // Deliberately not focused on a phone. Focusing opens the keyboard, and
    // iOS repositions position:fixed elements as the keyboard animates — the
    // panel visibly shuffles, through no style change of ours, which is why
    // nothing showed up in the geometry logs. Waiting for the reporter to tap
    // the field puts that movement where they asked for it. Nothing is lost:
    // iOS routinely ignores programmatic focus for raising the keyboard.
    //
    // preventScroll stays for the desktop: the sheet is position:fixed, so the
    // browser cannot bring the field into view by moving the panel and scrolls
    // the document instead.
    if (!isTouchPointer()) this.textarea.focus({ preventScroll: true })
  }

  private buildHTML(opts: PopupOptions): string {
    const m = opts.messages
    const quickOpts = m.popup.quickOptions
      .map(
        o => `
        <button class="mtb-quick-option" data-quick="${escapeHtml(o.label)}">
          <span class="mtb-quick-option-emoji">${escapeHtml(o.emoji)}</span>
          <span>${escapeHtml(o.label)}</span>
        </button>`,
      )
      .join('')

    return `
      <div class="mtb-popup-header">
        <div class="mtb-popup-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--mtb-brand-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <span class="mtb-popup-title">${escapeHtml(m.popup.about)} "${escapeHtml(opts.targetName)}"</span>
        <button class="mtb-popup-close" aria-label="${escapeHtml(m.popup.close)}">
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
        ${this.buildDisclosureRow(opts, m)}
        <div class="mtb-popup-actions">
          ${opts.onMyFeedback ? `<button class="mtb-my-feedback" type="button">${escapeHtml(m.popup.my_feedback)}</button>` : '<span></span>'}
          <span class="mtb-popup-actions-right">
            <button class="mtb-cancel-btn" type="button">${escapeHtml(m.popup.cancel)}</button>
            <button class="mtb-submit-btn" type="button" disabled>${escapeHtml(m.popup.submit)}</button>
          </span>
        </div>
      </div>
    `
  }



  // What is being attached, said once per submission. Three shapes:
  // after a recording — the recording alone, locked (to the reporter that is
  // ONE thing and the page image is simply part of it, so asking about a
  // screenshot separately would invent a second artifact they never chose);
  // pin flow — the screenshot as a real choice; draw flows — the screenshot
  // locked, because strokes are baked onto it.
  private buildDisclosureRow(opts: PopupOptions, m: I18nMessages): string {
    if (opts.recordingSeconds != null) {
      return `
        <label class="mtb-screenshot-opt mtb-screenshot-opt--locked" title="${escapeHtml(m.popup.recording_locked_hint)}">
          <input type="checkbox" checked disabled>
          <span>${escapeHtml(m.popup.recording_label)} (${Math.round(opts.recordingSeconds)}s)</span>
        </label>`
    }
    if (opts.onScreenshotToggle) {
      return `
        <label class="mtb-screenshot-opt" title="${escapeHtml(m.popup.screenshot_hint)}">
          <input type="checkbox"${opts.screenshotEnabled === false ? '' : ' checked'}>
          <span>${escapeHtml(m.popup.screenshot_label)}</span>
        </label>`
    }
    return `
        <label class="mtb-screenshot-opt mtb-screenshot-opt--locked" title="${escapeHtml(m.popup.screenshot_locked_hint)}">
          <input type="checkbox" checked disabled>
          <span>${escapeHtml(m.popup.screenshot_label)}</span>
        </label>`
  }

  private positionPopup(x: number, y: number, targetRect: TargetRect | undefined, tabPosition: 'left' | 'right'): void {
    if (this.sheet.apply()) return

    const frame = measureViewportFrame(tabPosition)
    const { vw, vh, minLeft, maxRight } = frame
    const margin = VIEWPORT_MARGIN
    const gap = 8
    const popupW = panelWidth(320, frame)
    const popupH = this.el.offsetHeight || 260

    let left: number
    let top: number

    // Anchoring to the element only helps while the element is small enough to
    // point at. A click on empty space lands on whatever section or body spans
    // the page, and its rect says nothing about where the user clicked: the top
    // edge is off-screen, so the popup flips, and the left edge is 0, so it
    // lands in the bottom-left corner however far right the click was.
    const anchorIsInformative =
      targetRect && targetRect.width < vw * 0.6 && targetRect.height < vh * 0.6

    if (targetRect && anchorIsInformative) {
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

    this.textarea.addEventListener('input', () => {
      this.updateSubmitState()
      this.onActivity?.()
    })

    this.textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (isImeConfirmKeydown(e)) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.submit(e)
      }
    })

    this.submitBtn.addEventListener('click', () => this.submit())
  }

  private updateSubmitState(): void {
    const hasText = this.textarea.value.trim().length > 0
    this.submitBtn.classList.toggle('ready', hasText)
    this.submitBtn.disabled = !hasText
  }

  private submit(initiatingKeydown?: KeyboardEvent): void {
    const text = this.textarea.value.trim()
    if (!text) return
    const description = this.selectedQuickOption ? `[${this.selectedQuickOption}] ${text}` : text
    if (initiatingKeydown) {
      this.onSubmit(description, initiatingKeydown)
    } else {
      this.onSubmit(description)
    }
  }

  releaseElement(): HTMLDivElement {
    this.releaseGuard?.()
    this.releaseGuard = null
    // Ownership of the element passes to the caller, which means destroy() will
    // never run for this instance. Stop observing here or the listener outlives
    // the popup and keeps writing `bottom` on an element it no longer manages.
    this.sheet.release()
    // Same fate for the Tab handler — but focus stays put: the successor
    // (clarify continuation) is mid-flow on this very element, and yanking
    // focus back to the host page would pull the reporter out of it.
    this.focusTrap.release()
    return this.el
  }

  destroy(): void {
    this.releaseGuard?.()
    this.releaseGuard = null
    this.sheet.release()
    this.focusTrap.release()
    this.el.remove()
    this.focusTrap.restoreFocus()
  }
}
