export interface MakeThisBetterConfig {
  projectKey: string
  entryMode?: 'button'
  locale?: string
  position?: 'left' | 'right'
  theme?: 'light' | 'dark' | 'auto'
  apiUrl?: string
  frustrationDetection?: boolean
  tabText?: string
  userToken?: string
  userTokenFn?: () => Promise<string>
  user?: {
    id?: string
    email?: string
    name?: string
  }
}

export interface TargetRect {
  top: number
  left: number
  width: number
  height: number
  bottom: number
}

export interface Annotation {
  type: 'pin' | 'draw'
  x: number
  y: number
  targetSelector?: string
  targetText?: string
  targetName?: string
  targetRect?: TargetRect
  drawPath?: string
}

export interface Breadcrumb {
  type: 'ui' | 'navigation' | 'console'
  category: 'ui.click' | 'ui.input' | 'navigation' | 'console.error'
  timestamp: number
  message?: string
  data?: Record<string, string>
}

export interface FeedbackPayload {
  description: string
  page_url: string
  user_agent: string
  browser: string
  os: string
  screen_width: number
  screen_height: number
  console_errors: string[]
  annotations: Annotation[]
  target_element?: {
    selector: string
    text: string
    name: string
  }
  user_id?: string
  user_email?: string
  user_name?: string
  reporter_external_id?: string
  reporter_email?: string
  recording_events?: Record<string, unknown>[]
  recording_duration?: number
  breadcrumbs?: Breadcrumb[]
}

export interface FeedbackResponse {
  id: string
  status: string
  project_id: string
  ai_clarify_available?: boolean
  skip_followup?: boolean
  board_url?: string
  identity_token?: string
}

export interface SubmissionSessionResponse {
  id: string
  token: string
  ai_clarify_available: boolean
}

export interface ClarifyMessage {
  role: string
  content: string
}

export interface ClarifyResponse {
  status: string
  messages: ClarifyMessage[]
  done: boolean
}
