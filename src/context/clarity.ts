import type { SessionRecordingData } from './session-recordings'

export function collectClarityRecording(): Promise<SessionRecordingData | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof (window as any).clarity !== 'function') {
      resolve(null)
      return
    }

    let resolved = false
    const resolveOnce = (data: SessionRecordingData | null): void => {
      if (resolved) return
      resolved = true
      resolve(data)
    }

    try {
      const clarity = (window as any).clarity as (...args: unknown[]) => void
      clarity('metadata', (data: Record<string, unknown>) => {
        if (data?.projectId && data?.userId && data?.sessionId) {
          const projectId = encodeURIComponent(String(data.projectId))
          const userId = encodeURIComponent(String(data.userId))
          const sessionId = encodeURIComponent(String(data.sessionId))
          resolveOnce({
            session_id: String(data.sessionId),
            replay_url: `https://clarity.microsoft.com/player/${projectId}/${userId}/${sessionId}`,
          })
        } else {
          resolveOnce(null)
        }
      })
    } catch {
      resolveOnce(null)
      return
    }

    setTimeout(() => resolveOnce(null), 500)
  })
}
