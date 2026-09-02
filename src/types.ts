export interface WidgetBrandColors {
  primary: string
  hover: string
  active: string
  onPrimary: string
}

export interface MakeThisBetterConfig {
  projectKey: string
  /**
   * 'button' (default) docks the feedback tab to the edge of the viewport.
   * 'api' renders no tab at all and waits for MakeThisBetter.open(), so the
   * host can put the entry point wherever it belongs in its own UI — a
   * settings menu, an overflow item, a support screen.
   */
  entryMode?: 'button' | 'api'
  locale?: string
  position?: 'left' | 'right'
  theme?: 'light' | 'dark' | 'auto'
  apiUrl?: string
  frustrationDetection?: boolean
  tabText?: string
  brandColors?: WidgetBrandColors
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
  /**
   * Viewport coordinates as of the moment the annotation was made — which is
   * not necessarily where the target sits now, because the page can scroll
   * before the reporter submits. Pair them with captureOffsetX/Y to get back to
   * a position that scrolling cannot move.
   */
  x: number
  y: number
  targetSelector?: string
  targetText?: string
  targetName?: string
  targetRect?: TargetRect
  drawPath?: string
  /**
   * Page scroll plus enclosing-container scroll at the instant the annotation
   * was made. Adding it to x/y (and to targetRect and drawPath, which share
   * their frame) gives the position in the screenshot's clone space, where
   * html-to-image renders every element unscrolled. Recording it here is what
   * keeps an annotation attached to what the reporter marked when they scroll
   * on their way to the submit button.
   *
   * Absent on annotations from clients that predate this field, which the
   * screenshot path still handles by measuring the scroll itself at capture
   * time.
   */
  captureOffsetX?: number
  captureOffsetY?: number
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
  metadata?: Record<string, unknown>
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
  board_url?: string
}

export interface ClarifyMessage {
  role: string
  content: string
  suggestions?: string[]
}

// Mirrors FeedbackSubmissionSession::AI_CLARIFICATION_STATUSES server-side. Kept
// as a union rather than `string` so a server-side rename fails type-check here
// instead of silently falling through every branch at runtime.
export type ClarifyStatus =
  | 'idle'
  | 'processing'
  | 'awaiting_response'
  | 'completed'
  | 'failed'

export interface ClarifyResponse {
  status: ClarifyStatus
  messages: ClarifyMessage[]
  /** Tappable answers for the question still on screen; empty when open-ended. */
  suggestions?: string[]
  done: boolean
}
