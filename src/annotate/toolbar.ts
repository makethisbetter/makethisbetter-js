import type { ShadowContainer } from '../widget/shadow'
import type { I18nMessages } from '../i18n'
import { isTouchPointer } from '../widget/pointer-kind'
import { escapeHtml } from '../context/dom-utils'

export type ToolbarMode = 'markup' | 'record'

// Mirrors the `height` the max-width: 480px block gives .mtb-toolbar. The
// safe-area inset stacked on top of it can only be measured, not predicted.
const MOBILE_BAR_HEIGHT_PX = 44

export class AnnotationToolbar {
  private el: HTMLDivElement
  // The capsule, which is what gets measured and dimmed. hintTextEl is only the
  // words inside it — dimming that instead would leave the capsule around them
  // at full strength, and shrink the region counted as "under the pointer".
  private hintBarEl: HTMLDivElement
  private hintTextEl!: HTMLSpanElement
  private host: HTMLElement
  private markupBtn!: HTMLButtonElement
  private recordBtn!: HTMLButtonElement
  private messages: I18nMessages
  private currentMode: ToolbarMode = 'markup'
  private readonly touch: boolean

  // The hint sits over the page and carries nothing to click, so it steps back
  // while the pointer is on top of it and comes forward again the moment the
  // pointer leaves. Nothing else about the page's movement affects it.
  //
  // This is a hover affordance, and touch has no hover — but a tap still emits
  // a compatibility move wherever the finger landed, which would dim the hint
  // for no reason. Restricting to a real mouse makes it a no-op on a phone.
  private handlePointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return

    const rect = this.hintBarEl.getBoundingClientRect()
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom

    this.hintBarEl.classList.toggle('mtb-hint-bar--under-pointer', inside)
  }

  // Tracks whether the touch-hint dismiss listener is currently attached, so
  // add and remove stay symmetric: it is only ever added on touch with the
  // hint showing, and destroy() must not issue a remove for an add that never
  // happened.
  private touchHintDismissListening = false

  private dismissTouchHint = (): void => {
    this.hintBarEl.classList.add('mtb-hint-bar--dismissed')
    this.stopTouchHintDismissListening()
  }

  private stopTouchHintDismissListening(): void {
    if (!this.touchHintDismissListening) return
    this.touchHintDismissListening = false
    document.removeEventListener('pointerdown', this.dismissTouchHint, true)
  }

  constructor(
    shadow: ShadowContainer,
    messages: I18nMessages,
    onExit: () => void,
    onModeChange?: (mode: ToolbarMode) => void,
    position: 'left' | 'right' = 'right',
    showTouchHint = true,
  ) {
    this.messages = messages
    this.touch = isTouchPointer()

    // Two siblings, not one element. A fixed-position child is laid out against
    // its nearest transformed ancestor rather than the viewport, and the bar is
    // transformed both at rest and by its entry animation — so a hint nested
    // inside it could never be centred on the page.
    this.hintBarEl = shadow.el<HTMLDivElement>('div', 'mtb-hint-bar')
    // "Click to comment" is a lie on a phone, where a tap is deliberately inert
    // — the hint has to describe the one gesture that does anything.
    this.hintBarEl.innerHTML = `<span class="mtb-toolbar-hint">${escapeHtml(this.idleHint())}</span>`
    if (this.touch && !showTouchHint) this.hintBarEl.classList.add('mtb-hint-bar--dismissed')

    this.el = shadow.el<HTMLDivElement>('div', 'mtb-toolbar')
    if (position === 'left') this.el.classList.add('left')
    this.el.innerHTML = this.buildHTML(messages)
    shadow.append(this.hintBarEl, this.el)

    // Lets the CSS retire the tab for exactly as long as this bar is up. Keyed
    // to the bar's own lifetime rather than to the tab's active state: the tab
    // is still active while a clarification card is open, and by then the bar
    // is gone — hiding it there would leave no way out at all.
    this.host = shadow.host
    this.host.setAttribute('data-mtb-toolbar', '')

    this.hintTextEl = this.hintBarEl.querySelector('.mtb-toolbar-hint')!
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

    document.addEventListener('pointermove', this.handlePointerMove as EventListener)
    if (this.touch && showTouchHint) {
      document.addEventListener('pointerdown', this.dismissTouchHint, true)
      this.touchHintDismissListening = true
    }
  }

  private buildHTML(m: I18nMessages): string {
    return `
      <div class="mtb-toolbar-modes">
        <button class="mtb-toolbar-mode-btn mtb-toolbar-mode-markup active" aria-label="${escapeHtml(m.toolbar.markup)}" title="${escapeHtml(m.toolbar.markup)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg><span class="mtb-toolbar-label">${escapeHtml(m.toolbar.markup)}</span>
        </button>
        <button class="mtb-toolbar-mode-btn mtb-toolbar-mode-record" aria-label="${escapeHtml(m.toolbar.record)}" title="${escapeHtml(m.toolbar.record)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="13" height="12" rx="2.5"/><path d="M15 10.5 21.2 7.4a.6.6 0 0 1 .8.5v8.2a.6.6 0 0 1-.8.5L15 13.5z"/></svg><span class="mtb-toolbar-label">${escapeHtml(m.toolbar.record)}</span>
        </button>
      </div>
      <span class="mtb-toolbar-sep"></span>
      <button class="mtb-exit-btn" aria-label="${escapeHtml(m.toolbar.exit)}" title="${escapeHtml(m.toolbar.exit)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg><span class="mtb-toolbar-label">${escapeHtml(m.toolbar.exit)}</span>
      </button>
    `
  }

  private idleHint(): string {
    return this.touch ? this.messages.toolbar.hintTouch : this.messages.toolbar.hint
  }

  setMode(mode: ToolbarMode): void {
    this.currentMode = mode
    if (mode === 'markup') {
      this.markupBtn.classList.add('active')
      this.recordBtn.classList.remove('active')
      this.hintTextEl.textContent = this.idleHint()
    } else {
      this.markupBtn.classList.remove('active')
      this.recordBtn.classList.add('active')
      this.hintTextEl.textContent = this.messages.toolbar.hintRecord
    }
  }

  getMode(): ToolbarMode {
    return this.currentMode
  }

  /**
   * How much vertical room the bar occupies, including any safe-area inset.
   *
   * Falls back to the height the stylesheet declares when measurement returns
   * nothing — which happens before first paint, and in any environment without
   * layout. Reserving the wrong amount is recoverable; reserving none means
   * the bar covers the page again, which is the defect this exists to fix.
   */
  height(): number {
    return this.el.getBoundingClientRect().height || MOBILE_BAR_HEIGHT_PX
  }

  destroy(): void {
    document.removeEventListener('pointermove', this.handlePointerMove as EventListener)
    this.stopTouchHintDismissListening()
    this.host.removeAttribute('data-mtb-toolbar')
    this.hintBarEl.remove()
    this.el.remove()
  }
}
