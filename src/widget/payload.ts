import type { ClarityData } from '../context/clarity'
import type { PageContext } from '../context/collector'
import { filterSensitiveValue, sanitizeUrl } from '../privacy/sanitize'
import type { Annotation, Breadcrumb, FeedbackPayload, MakeThisBetterConfig } from '../types'
import type { RecordingResult } from '../record/session'

export interface BuildPayloadOptions {
  description: string
  pageContext: PageContext
  consoleErrors: string[]
  annotation: Annotation | null
  user: MakeThisBetterConfig['user']
  recording?: RecordingResult
  anonId?: string
  anonEmail?: string
  breadcrumbs?: Breadcrumb[]
  clarityData?: ClarityData | null
}

export function buildPayload(options: BuildPayloadOptions): FeedbackPayload {
  const { description, pageContext, consoleErrors, annotation, user, recording, anonId, anonEmail, breadcrumbs, clarityData } = options

  const capturedContext = filterSensitiveValue({
    description,
    ...pageContext,
    page_url: sanitizeUrl(pageContext.page_url),
    console_errors: consoleErrors,
    annotations: annotation ? [annotation] : [],
    target_element: annotation?.targetSelector
      ? {
          selector: annotation.targetSelector,
          text: annotation.targetText ?? '',
          name: annotation.targetName ?? '',
        }
      : undefined,
    recording_events: recording?.events,
    recording_duration: recording?.duration,
    breadcrumbs,
  })

  return {
    ...capturedContext,
    user_id: user?.id,
    user_email: user?.email,
    user_name: user?.name,
    // An identified user carries no anonymous identity: the host has vouched
    // for who the reporter is, so attaching the stored anon id/email would tie
    // that account to a stranger's earlier anonymous submissions.
    reporter_external_id: user ? undefined : anonId,
    reporter_email: user ? undefined : anonEmail,
    metadata: clarityData ? { clarity: clarityData } : undefined,
  }
}
