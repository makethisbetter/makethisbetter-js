import { WidgetController } from './widget/controller'
import type { MakeThisBetterConfig } from './types'

let instance: WidgetController | null = null
let lastConfig: MakeThisBetterConfig | null = null

const MakeThisBetter = {
  init(config: MakeThisBetterConfig): void {
    if (instance) {
      instance.destroy()
      instance = null
    }
    lastConfig = config
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        instance = new WidgetController(config)
      })
    } else {
      instance = new WidgetController(config)
    }
  },

  destroy(): void {
    instance?.destroy()
    instance = null
    lastConfig = null
  },

  setLocale(locale: string): void {
    if (lastConfig) lastConfig.locale = locale
    instance?.setLocale(locale)
  },
}

export { MakeThisBetter }
export type { MakeThisBetterConfig }

if (typeof window !== 'undefined') {
  (window as Window & { MakeThisBetter?: typeof MakeThisBetter }).MakeThisBetter = MakeThisBetter

  document.addEventListener('turbo:load', () => {
    if (lastConfig && !document.getElementById('mtb-widget-host')) {
      instance?.destroy()
      instance = new WidgetController(lastConfig)
    }
  })
}
