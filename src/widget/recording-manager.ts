import { RecordSession } from '../record/session'
import type { RecordingResult } from '../record/session'
import { RecordControlBar } from '../record/control-bar'
import type { ShadowContainer } from './shadow'
import type { I18nMessages } from '../i18n'

export type { RecordingResult }

export class RecordingManager {
  private session: RecordSession | null = null
  private bar: RecordControlBar | null = null
  private result: RecordingResult | null = null

  async start(
    shadow: ShadowContainer,
    messages: I18nMessages,
    onStop: () => void,
  ): Promise<void> {
    this.session = new RecordSession(shadow, onStop)
    this.bar = new RecordControlBar(
      shadow,
      messages,
      () => this.session?.getDuration() ?? 0,
      onStop,
    )
    await this.session.start()
  }

  stop(): RecordingResult | null {
    if (!this.session) return null
    this.result = this.session.stop()
    this.teardownUI()
    return this.result
  }

  getRecording(): RecordingResult | null {
    return this.result
  }

  destroy(): void {
    this.teardownUI()
    this.result = null
  }

  private teardownUI(): void {
    this.session?.destroy()
    this.session = null
    this.bar?.destroy()
    this.bar = null
  }
}
