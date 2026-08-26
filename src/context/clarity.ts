export interface ClarityData {
  project_id: string
  user_id: string
  session_id: string
}

export function collectClarityData(): Promise<ClarityData | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof (window as any).clarity !== 'function') {
      resolve(null)
      return
    }

    let resolved = false
    const resolveOnce = (data: ClarityData | null): void => {
      if (resolved) return
      resolved = true
      resolve(data)
    }

    try {
      const clarity = (window as any).clarity as (...args: unknown[]) => void
      clarity('metadata', (data: Record<string, unknown>) => {
        if (data?.projectId && data?.userId && data?.sessionId) {
          resolveOnce({
            project_id: String(data.projectId),
            user_id: String(data.userId),
            session_id: String(data.sessionId),
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
