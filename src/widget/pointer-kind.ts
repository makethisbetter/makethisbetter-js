/**
 * Whether a finger is driving, rather than a mouse.
 *
 * Several behaviours fork on this — freezing the host page, which input
 * surface collects a note — and they have to agree, so the question is asked
 * in exactly one place.
 *
 * No matchMedia means no evidence of a touch device: assume a mouse and leave
 * the desktop path alone, which is the one that already worked.
 */
export function isTouchPointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}
