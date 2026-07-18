import type { ShadowContainer } from '../widget/shadow'

export class PinMarker {
  private pins: HTMLDivElement[] = []
  private shadow: ShadowContainer

  constructor(shadow: ShadowContainer) {
    this.shadow = shadow
  }

  addPin(x: number, y: number, index: number): void {
    const pin = this.shadow.el<HTMLDivElement>('div', 'mtb-pin')
    pin.textContent = String(index)
    pin.style.top = `${y}px`
    pin.style.left = `${x}px`
    this.shadow.append(pin)
    this.pins.push(pin)
  }

  clearAll(): void {
    for (const pin of this.pins) pin.remove()
    this.pins = []
  }

  destroy(): void {
    this.clearAll()
  }
}
