import { describe, expect, it } from 'vitest'
import { buildPayload } from './payload'
import type { PageContext } from '../context/collector'
import type { Annotation, Breadcrumb, MakeThisBetterConfig } from '../types'
import type { RecordingResult } from '../record/session'

const pageContext: PageContext = {
  page_url: 'https://example.com/dashboard',
  user_agent: 'Mozilla/5.0',
  browser: 'Chrome 120',
  os: 'macOS',
  screen_width: 1920,
  screen_height: 1080,
}

describe('buildPayload', () => {
  it('returns base payload without annotation, user, or recording', () => {
    const result = buildPayload({ description: 'Button is broken', pageContext, consoleErrors: ['TypeError: x'], annotation: null, user: undefined })

    expect(result.description).toBe('Button is broken')
    expect(result.page_url).toBe('https://example.com/dashboard')
    expect(result.user_agent).toBe('Mozilla/5.0')
    expect(result.browser).toBe('Chrome 120')
    expect(result.os).toBe('macOS')
    expect(result.screen_width).toBe(1920)
    expect(result.screen_height).toBe(1080)
    expect(result.console_errors).toEqual(['TypeError: x'])
    expect(result.annotations).toEqual([])
    expect(result.target_element).toBeUndefined()
    expect(result.user_id).toBeUndefined()
    expect(result.user_email).toBeUndefined()
    expect(result.user_name).toBeUndefined()
    expect(result.recording_events).toBeUndefined()
    expect(result.recording_duration).toBeUndefined()
  })

  it('includes annotation and target_element when annotation has targetSelector', () => {
    const annotation: Annotation = {
      type: 'pin',
      x: 200,
      y: 300,
      targetSelector: '#export-btn',
      targetText: 'Export PDF',
      targetName: 'Export Button',
    }

    const result = buildPayload({ description: 'Export fails', pageContext, consoleErrors: [], annotation, user: undefined })

    expect(result.annotations).toEqual([annotation])
    expect(result.target_element).toEqual({
      selector: '#export-btn',
      text: 'Export PDF',
      name: 'Export Button',
    })
  })

  it('omits target_element when annotation has no targetSelector', () => {
    const annotation: Annotation = {
      type: 'draw',
      x: 100,
      y: 150,
      drawPath: 'M0 0 L10 10',
    }

    const result = buildPayload({ description: 'UI glitch', pageContext, consoleErrors: [], annotation, user: undefined })

    expect(result.annotations).toEqual([annotation])
    expect(result.target_element).toBeUndefined()
  })

  it('defaults targetText and targetName to empty string when missing', () => {
    const annotation: Annotation = {
      type: 'pin',
      x: 50,
      y: 60,
      targetSelector: '.header',
    }

    const result = buildPayload({ description: 'Header issue', pageContext, consoleErrors: [], annotation, user: undefined })

    expect(result.target_element).toEqual({
      selector: '.header',
      text: '',
      name: '',
    })
  })

  it('includes user fields when user is provided', () => {
    const user: MakeThisBetterConfig['user'] = {
      id: 'usr_123',
      email: 'alice@example.com',
      name: 'Alice',
    }

    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user })

    expect(result.user_id).toBe('usr_123')
    expect(result.user_email).toBe('alice@example.com')
    expect(result.user_name).toBe('Alice')
  })

  it('includes partial user fields', () => {
    const user: MakeThisBetterConfig['user'] = {
      email: 'bob@example.com',
    }

    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user })

    expect(result.user_id).toBeUndefined()
    expect(result.user_email).toBe('bob@example.com')
    expect(result.user_name).toBeUndefined()
  })

  it('includes reporter_external_id when anonId is provided without user', () => {
    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user: undefined, anonId: 'anon_abc-123' })

    expect(result.reporter_external_id).toBe('anon_abc-123')
  })

  it('ignores anonId when user is provided', () => {
    const user: MakeThisBetterConfig['user'] = { id: 'usr_123' }

    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user, anonId: 'anon_abc-123' })

    expect(result.reporter_external_id).toBeUndefined()
    expect(result.user_id).toBe('usr_123')
  })

  it('includes reporter_email when anonEmail is provided without user', () => {
    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user: undefined, anonId: 'anon_abc-123', anonEmail: 'anon@example.com' })

    expect(result.reporter_email).toBe('anon@example.com')
  })

  it('ignores anonEmail when user is provided', () => {
    const user: MakeThisBetterConfig['user'] = { id: 'usr_123', email: 'host@example.com' }

    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user, anonEmail: 'anon@example.com' })

    expect(result.reporter_email).toBeUndefined()
    expect(result.user_email).toBe('host@example.com')
  })

  it('includes recording data when recording is provided', () => {
    const recording: RecordingResult = {
      events: [{ type: 3, data: { source: 2 } }],
      duration: 12500,
    }

    const result = buildPayload({ description: 'Screen issue', pageContext, consoleErrors: [], annotation: null, user: undefined, recording })

    expect(result.recording_events).toEqual([{ type: 3, data: { source: 2 } }])
    expect(result.recording_duration).toBe(12500)
  })

  it('passes through empty console_errors array', () => {
    const result = buildPayload({ description: 'All good', pageContext, consoleErrors: [], annotation: null, user: undefined })

    expect(result.console_errors).toEqual([])
  })

  it('includes breadcrumbs when provided', () => {
    const crumbs: Breadcrumb[] = [
      { type: 'ui', category: 'ui.click', timestamp: 1000, message: 'Save', data: { selector: '#save' } },
      { type: 'navigation', category: 'navigation', timestamp: 2000, data: { from: '/a', to: '/b' } },
    ]

    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user: undefined, breadcrumbs: crumbs })

    expect(result.breadcrumbs).toEqual(crumbs)
    expect(result.breadcrumbs).toHaveLength(2)
  })

  it('omits breadcrumbs when not provided', () => {
    const result = buildPayload({ description: 'Feedback', pageContext, consoleErrors: [], annotation: null, user: undefined })

    expect(result.breadcrumbs).toBeUndefined()
  })

  it('combines all optional fields together', () => {
    const annotation: Annotation = {
      type: 'pin',
      x: 10,
      y: 20,
      targetSelector: '#save',
      targetText: 'Save',
      targetName: 'Save Button',
    }
    const user: MakeThisBetterConfig['user'] = {
      id: 'usr_456',
      email: 'carol@example.com',
      name: 'Carol',
    }
    const recording: RecordingResult = {
      events: [{ type: 2 }],
      duration: 5000,
    }
    const crumbs: Breadcrumb[] = [
      { type: 'ui', category: 'ui.click', timestamp: 1000, message: 'Save', data: { selector: '#save' } },
    ]

    const result = buildPayload({
      description: 'Save broken',
      pageContext,
      consoleErrors: ['Error: 500'],
      annotation,
      user,
      recording,
      breadcrumbs: crumbs,
    })

    expect(result.description).toBe('Save broken')
    expect(result.annotations).toHaveLength(1)
    expect(result.target_element?.selector).toBe('#save')
    expect(result.user_id).toBe('usr_456')
    expect(result.recording_duration).toBe(5000)
    expect(result.console_errors).toEqual(['Error: 500'])
    expect(result.breadcrumbs).toEqual(crumbs)
  })

  it('filters credentials across captured context without changing reporter identity', () => {
    const credential = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfMTIzIn0.dGVzdC1zaWduYXR1cmU'
    const sensitiveContext: PageContext = {
      ...pageContext,
      page_url: 'https://example.com/reset?token=secret#confirm',
    }
    const annotation: Annotation = {
      type: 'pin',
      x: 10,
      y: 20,
      targetSelector: `#${credential}`,
      targetText: `Token ${credential}`,
      targetName: 'Token row',
    }
    const recording: RecordingResult = {
      events: [{ type: 2, data: { text: `Card 4242 4242 4242 4242` } }],
      duration: 5000,
    }
    const crumbs: Breadcrumb[] = [
      { type: 'ui', category: 'ui.click', timestamp: 1000, message: `Open ${credential}` },
    ]
    const user: MakeThisBetterConfig['user'] = {
      id: 'usr_123',
      email: 'alice@example.com',
      name: 'Alice',
    }

    const result = buildPayload({
      description: `Payment failed for 4242 4242 4242 4242`,
      pageContext: sensitiveContext,
      consoleErrors: [`Error ${credential}`],
      annotation,
      user,
      recording,
      breadcrumbs: crumbs,
    })

    expect(JSON.stringify(result)).not.toContain(credential)
    expect(JSON.stringify(result)).not.toContain('4242 4242 4242 4242')
    expect(result.description).toBe('Payment failed for [Filtered]')
    expect(result.page_url).toBe('https://example.com/reset')
    expect(result.user_email).toBe('alice@example.com')
    expect(result.user_name).toBe('Alice')
  })
})
