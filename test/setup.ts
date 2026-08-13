// jsdom 24 ships no PointerEvent constructor and no pointer-capture methods
// (verified: `typeof window.PointerEvent === 'undefined'`). The widget's
// annotation layer runs entirely on pointer events, so without these stubs
// every test touching it would fail for a reason that has nothing to do with
// the code under test.
//
// PointerEvent extends MouseEvent in the spec, so inheriting from jsdom's
// MouseEvent gives us clientX/clientY/button for free; we only add the pointer
// fields the widget actually reads.

if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.pointerType = init.pointerType ?? 'mouse'
      // Real browsers default isPrimary to false, but every test and every
      // single-pointer interaction is primary. Defaulting to true keeps test
      // setup honest about intent: a test for multi-touch must opt out.
      this.isPrimary = init.isPrimary ?? true
    }
  }

  ;(globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventShim
  ;(globalThis as { window?: { PointerEvent?: unknown } }).window!.PointerEvent = PointerEventShim
}

// Note on matchMedia: jsdom ships none, and the widget asks it whether the
// visitor is using a finger. No shim here on purpose — the production code
// treats an absent matchMedia as "not a touch device", so the default in tests
// is a mouse, and a test that cares about touch stubs it locally.

// Pointer capture is a no-op in jsdom. The widget calls these on every stroke,
// so they have to exist; the capture semantics themselves are only observable
// on a real device.
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
}
