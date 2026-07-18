import { WidgetController } from './widget/controller'
import type { MakeThisBetterConfig } from './types'

let instance: WidgetController | null = null

const MakeThisBetter = {
  init(config: MakeThisBetterConfig): void {
    if (instance) {
      instance.destroy()
      instance = null
    }
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
  },
}

export { MakeThisBetter }
export type { MakeThisBetterConfig }

if (typeof window !== 'undefined') {
  (window as Window & { MakeThisBetter?: typeof MakeThisBetter }).MakeThisBetter = MakeThisBetter
}
