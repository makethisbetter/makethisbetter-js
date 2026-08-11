import { describe, expect, it } from 'vitest'
import { isDemoApiRequest } from './mock-api'

describe('isDemoApiRequest', () => {
  const pageUrl = 'http://localhost:5173/'

  it('matches requests to the demo mock API', () => {
    expect(isDemoApiRequest('/__mtb_mock/api/v1/feedback', pageUrl)).toBe(true)
    expect(isDemoApiRequest(new URL('/__mtb_mock/api/v1/feedback_submission_sessions', pageUrl), pageUrl)).toBe(true)
  })

  it('does not match a custom API URL with the same endpoint path', () => {
    expect(isDemoApiRequest('https://api.example.com/api/v1/feedback', pageUrl)).toBe(false)
  })

  it('does not match a similar path outside the mock API boundary', () => {
    expect(isDemoApiRequest('/__mtb_mock/api/v10/feedback', pageUrl)).toBe(false)
  })
})
