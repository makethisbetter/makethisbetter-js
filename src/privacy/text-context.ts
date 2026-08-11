import { filterSensitiveText } from './sanitize'

const MAX_GROUPED_TEXT_LENGTH = 512
type SensitiveTextState = 'none' | 'sensitive' | 'contains-sensitive-child' | 'too-large'
export type SensitiveTextContext = WeakMap<Element, SensitiveTextState>

export function createSensitiveTextContext(): SensitiveTextContext {
  return new WeakMap()
}

export function hasSensitiveTextContext(node: Node, context: SensitiveTextContext): boolean {
  let element = node.parentElement
  while (element && element !== document.body && element !== document.documentElement) {
    const state = sensitiveTextState(element, context)
    if (state === 'sensitive') return true
    if (state === 'contains-sensitive-child' || state === 'too-large') return false
    element = element.parentElement
  }
  return false
}

function sensitiveTextState(element: Element, context: SensitiveTextContext): SensitiveTextState {
  const cached = context.get(element)
  if (cached) return cached

  const text = element.textContent ?? ''
  let state: SensitiveTextState = 'none'
  if (text.length > MAX_GROUPED_TEXT_LENGTH) {
    state = 'too-large'
  } else if (filterSensitiveText(text) !== text) {
    const childContainsSensitiveText = Array.from(element.children).some((child) => {
      const childState = sensitiveTextState(child, context)
      return childState === 'sensitive' || childState === 'contains-sensitive-child'
    })
    state = childContainsSensitiveText ? 'contains-sensitive-child' : 'sensitive'
  }
  context.set(element, state)
  return state
}
