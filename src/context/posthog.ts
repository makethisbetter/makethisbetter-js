import type { SessionRecordingData } from './session-recordings'

export function collectPostHogRecording(): SessionRecordingData | null {
  if (typeof window === 'undefined') return null
  const ph = (window as any).posthog
  if (!ph || typeof ph.get_session_id !== 'function') return null

  try {
    const sessionId = ph.get_session_id()
    if (!sessionId) return null

    const replayUrl =
      typeof ph.get_session_replay_url === 'function'
        ? ph.get_session_replay_url({ withTimestamp: true })
        : null
    if (!replayUrl) return null

    return {
      session_id: String(sessionId),
      replay_url: String(replayUrl),
    }
  } catch {
    return null
  }
}
