import { describe, expect, it } from 'vitest'
import { filterInputValue, isSensitiveField } from './fields'

function input(attributes: Record<string, string | undefined> = {}): HTMLInputElement {
  const element = document.createElement('input')
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, value)
  }
  return element
}

describe('isSensitiveField', () => {
  it.each([
    { type: 'password' },
    { type: 'hidden' },
    { type: 'file' },
    { autocomplete: 'current-password' },
    { autocomplete: 'new-password' },
    { autocomplete: 'one-time-code' },
    { autocomplete: 'cc-number' },
    { autocomplete: 'cc-csc' },
    { autocomplete: 'cc-exp' },
    { name: 'card_number' },
    { id: 'payment-cvv' },
    { 'aria-label': 'Verification code' },
    { placeholder: 'API key' },
    { name: 'access_token' },
    { name: 'accessToken' },
    { id: 'cardCvv' },
    { name: 'privateKey' },
    { name: 'credential' },
    { name: 'filename' },
    { name: 'otp_code' },
    { name: 'card_number_1' },
  ])('recognizes $type$autocomplete$name$id$aria-label$placeholder as sensitive', (attributes) => {
    expect(isSensitiveField(input(attributes))).toBe(true)
  })

  it.each([
    { type: 'email', name: 'email' },
    { type: 'search', name: 'query' },
    { type: 'text', name: 'order_number' },
    { type: 'number', name: 'amount' },
    { type: 'text', name: 'notes' },
    { type: 'number', name: 'token_count' },
  ])('keeps ordinary field $name', (attributes) => {
    expect(isSensitiveField(input(attributes))).toBe(false)
  })
})

describe('filterInputValue', () => {
  it('filters every value from a sensitive field', () => {
    expect(filterInputValue('hunter2', input({ type: 'password' }))).toBe('[Filtered]')
  })

  it('filters a credential value from an ordinary field', () => {
    expect(filterInputValue('4242 4242 4242 4242', input({ name: 'notes' }))).toBe('[Filtered]')
  })

  it('keeps an ordinary value from an ordinary field', () => {
    expect(filterInputValue('export is slow', input({ name: 'notes' }))).toBe('export is slow')
  })
})
