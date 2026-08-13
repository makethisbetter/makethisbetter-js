import { describe, expect, it } from 'vitest'
import { filterSensitiveText, filterSensitiveValue, sanitizeUrl } from './sanitize'

describe('filterSensitiveText', () => {
  it.each([
    ['Card 4242 4242 4242 4242 was rejected', 'Card [Filtered] was rejected'],
    [
      'Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfMTIzIn0.dGVzdC1zaWduYXR1cmU',
      'Token [Filtered]',
    ],
    [
      'Key -----BEGIN PRIVATE KEY-----\nZmFrZS1rZXktbWF0ZXJpYWw=\n-----END PRIVATE KEY-----',
      'Key [Filtered]',
    ],
    ['API sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'API [Filtered]'],
    ['GitHub ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'GitHub [Filtered]'],
  ])('filters a high-confidence credential in %s', (input, expected) => {
    expect(filterSensitiveText(input)).toBe(expected)
  })

  it('keeps ordinary business text and non-card numbers', () => {
    const input = 'Order 1234567890123456 for alice@example.com totals $124.00'

    expect(filterSensitiveText(input)).toBe(input)
  })

  it('is idempotent', () => {
    expect(filterSensitiveText('Card [Filtered]')).toBe('Card [Filtered]')
  })

  it('replaces a malformed URL instead of retaining its query and fragment', () => {
    expect(filterSensitiveText('Open https://%?token=short-secret#confirm'))
      .toBe('Open [Filtered]')
  })
})

describe('sanitizeUrl', () => {
  it('keeps only origin and pathname', () => {
    expect(sanitizeUrl('https://app.example.com/reset-password?token=secret#step-2'))
      .toBe('https://app.example.com/reset-password')
  })

  it('returns an empty string for an invalid URL', () => {
    expect(sanitizeUrl('not a URL')).toBe('')
  })
})

describe('filterSensitiveValue', () => {
  it('filters short secrets whose structured key declares sensitive semantics', () => {
    const event = {
      data: {
        attributes: {
          'data-api-key': 'short-secret',
          'token-count': 12,
          title: 'ordinary metadata',
        },
      },
    }

    expect(filterSensitiveValue(event)).toEqual({
      data: {
        attributes: {
          'data-api-key': '[Filtered]',
          'token-count': 12,
          title: 'ordinary metadata',
        },
      },
    })
  })

  it('filters a structured value declared sensitive by a sibling attribute', () => {
    const event = {
      type: 2,
      tagName: 'meta',
      attributes: { name: 'csrf-token', content: 'meta-short-secret' },
    }

    expect(filterSensitiveValue(event)).toEqual({
      type: 2,
      tagName: 'meta',
      attributes: { name: 'csrf-token', content: '[Filtered]' },
    })
  })
})
