import { FILTERED_VALUE, filterSensitiveText, isSensitiveFieldAttributes } from './sanitize'

export function isSensitiveField(element: Element): boolean {
  return isSensitiveFieldAttributes({
    type: element.getAttribute('type'),
    autocomplete: element.getAttribute('autocomplete'),
    name: element.getAttribute('name'),
    id: element.id,
    'aria-label': element.getAttribute('aria-label'),
    placeholder: element.getAttribute('placeholder'),
  })
}

export function filterInputValue(value: string, element: Element): string {
  if (!value) return value
  if (isSensitiveField(element)) return FILTERED_VALUE
  return filterSensitiveText(value)
}
