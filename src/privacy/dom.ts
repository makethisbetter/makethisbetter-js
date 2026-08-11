// rrweb's own defaults for opting an element out of a replay. Named here so the
// README can document them and so the values stay in one place.
export const BLOCK_CLASS = 'rr-block'
export const MASK_TEXT_CLASS = 'rr-mask'

export const PRIVACY_SELECTOR = `.${BLOCK_CLASS}, .${MASK_TEXT_CLASS}`

export function isPrivacyProtected(element: Element): boolean {
  return element.closest(PRIVACY_SELECTOR) !== null
}

export function structuralElementName(element: Element): string {
  const role = element.getAttribute('role')?.trim().split(/\s+/)[0]
  if (role && /^[a-z][a-z0-9-]*$/i.test(role)) return role
  return element.tagName.toLowerCase()
}

export function structuralElementSelector(element: Element): string {
  return element.tagName.toLowerCase()
}
