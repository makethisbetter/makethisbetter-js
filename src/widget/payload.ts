import type { PageContext } from '../context/collector'
import type { Annotation, Breadcrumb, FeedbackPayload, MakeThisBetterConfig } from '../types'
import type { RecordingResult } from '../record/session'

export function buildPayload(
  description: string,
  pageContext: PageContext,
  consoleErrors: string[],
  annotation: Annotation | null,
  user: MakeThisBetterConfig['user'],
  recording?: RecordingResult,
  anonId?: string,
  anonEmail?: string,
  breadcrumbs?: Breadcrumb[],
): FeedbackPayload {
  return {
    description,
    ...pageContext,
    console_errors: consoleErrors,
    annotations: annotation ? [annotation] : [],
    target_element: annotation?.targetSelector
      ? {
          selector: annotation.targetSelector,
          text: annotation.targetText ?? '',
          name: annotation.targetName ?? '',
        }
      : undefined,
    user_id: user?.id,
    user_email: user?.email,
    user_name: user?.name,
    reporter_external_id: user ? undefined : anonId,
    reporter_email: user ? undefined : anonEmail,
    recording_events: recording?.events,
    recording_duration: recording?.duration,
    breadcrumbs,
  }
}
