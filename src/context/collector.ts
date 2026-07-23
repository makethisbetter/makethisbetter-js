export interface PageContext {
  page_url: string
  user_agent: string
  browser: string
  os: string
  screen_width: number
  screen_height: number
}

export function collectPageContext(): PageContext {
  return {
    page_url: window.location.href,
    user_agent: navigator.userAgent,
    browser: detectBrowser(),
    os: detectOS(),
    screen_width: window.screen.width,
    screen_height: window.screen.height,
  }
}

function detectBrowser(): string {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return `Edge ${ua.match(/Edg\/(\S+)/)?.[1] ?? ''}`
  if (/OPR\//.test(ua)) return `Opera ${ua.match(/OPR\/(\S+)/)?.[1] ?? ''}`
  if (/Chrome\//.test(ua)) return `Chrome ${ua.match(/Chrome\/(\S+)/)?.[1] ?? ''}`
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return `Safari ${ua.match(/Version\/(\S+)/)?.[1] ?? ''}`
  if (/Firefox\//.test(ua)) return `Firefox ${ua.match(/Firefox\/(\S+)/)?.[1] ?? ''}`
  return 'Unknown'
}

function detectOS(): string {
  const ua = navigator.userAgent
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11'
  if (/Windows NT/.test(ua)) return 'Windows'
  if (/Mac OS X 10_15|macOS 1[56789]/.test(ua)) return 'macOS'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Android/.test(ua)) return `Android ${ua.match(/Android (\d+)/)?.[1] ?? ''}`
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Unknown'
}
