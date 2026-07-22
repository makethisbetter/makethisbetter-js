import cssText from '../styles/widget.css?inline'
import type { MakeThisBetterConfig } from '../types'

export class ShadowContainer {
  private host: HTMLElement
  readonly root: ShadowRoot

  constructor(theme: MakeThisBetterConfig['theme'] = 'auto') {
    this.host = document.createElement('div')
    this.host.id = 'mtb-widget-host'
    this.host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;'
    this.host.setAttribute('data-mtb-theme', theme)
    document.body.appendChild(this.host)

    this.root = this.host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = cssText
    this.root.appendChild(style)
  }

  el<T extends HTMLElement = HTMLElement>(tag: string, className?: string): T {
    const el = document.createElement(tag) as T
    if (className) el.className = className
    return el
  }

  append(...nodes: Node[]): void {
    for (const n of nodes) this.root.appendChild(n)
  }

  remove(...nodes: Node[]): void {
    for (const n of nodes) {
      if (n.parentNode === this.root) this.root.removeChild(n)
    }
  }

  destroy(): void {
    // host.remove() is a safe no-op if the host is already detached — e.g.
    // when Turbo swapped document.body on navigation. removeChild(host) would
    // throw NotFoundError there, aborting re-init and dropping the widget.
    this.host.remove()
  }
}
