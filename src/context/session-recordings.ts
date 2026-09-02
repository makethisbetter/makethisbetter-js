import { collectClarityRecording } from './clarity'
import { collectPostHogRecording } from './posthog'

export interface SessionRecordingData {
  session_id: string
  replay_url: string
}

export async function collectSessionRecordings(): Promise<Record<string, SessionRecordingData>> {
  const result: Record<string, SessionRecordingData> = {}

  const clarity = await collectClarityRecording()
  if (clarity) result.clarity = clarity

  const posthog = collectPostHogRecording()
  if (posthog) result.posthog = posthog

  return result
}
