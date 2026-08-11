import { afterEach, describe, it, expect } from 'vitest'
import { ShadowContainer } from '../widget/shadow'
import { PinMarker } from './pin'

describe('PinMarker', () => {
  let shadow: ShadowContainer
  let pin: PinMarker

  function setup() {
    shadow = new ShadowContainer()
    pin = new PinMarker(shadow)
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('creates an instance without adding any pins', () => {
      setup()
      expect(shadow.root.querySelectorAll('.mtb-pin').length).toBe(0)
      pin.destroy()
    })
  })

  describe('addPin', () => {
    it('adds a pin element to the shadow root', () => {
      setup()
      pin.addPin(100, 200)
      const pinEl = shadow.root.querySelector('.mtb-pin')
      expect(pinEl).toBeInstanceOf(HTMLDivElement)
      expect((pinEl as HTMLDivElement).style.top).toBe('200px')
      expect((pinEl as HTMLDivElement).style.left).toBe('100px')
      pin.destroy()
    })

    it('adds multiple pins', () => {
      setup()
      pin.addPin(10, 20)
      pin.addPin(30, 40)
      pin.addPin(50, 60)
      const pins = shadow.root.querySelectorAll('.mtb-pin')
      expect(pins.length).toBe(3)
      pin.destroy()
    })
  })

  describe('clearAll', () => {
    it('removes all pin elements from the shadow root', () => {
      setup()
      pin.addPin(10, 20)
      pin.addPin(30, 40)
      pin.clearAll()
      expect(shadow.root.querySelectorAll('.mtb-pin').length).toBe(0)
      pin.destroy()
    })

    it('is safe to call when no pins exist', () => {
      setup()
      expect(() => pin.clearAll()).not.toThrow()
      pin.destroy()
    })

    it('allows adding new pins after clearing', () => {
      setup()
      pin.addPin(10, 20)
      pin.clearAll()
      pin.addPin(50, 60)
      expect(shadow.root.querySelectorAll('.mtb-pin').length).toBe(1)
      pin.destroy()
    })
  })

  describe('destroy', () => {
    it('removes all pins via clearAll', () => {
      setup()
      pin.addPin(10, 20)
      pin.addPin(30, 40)
      pin.destroy()
      expect(shadow.root.querySelectorAll('.mtb-pin').length).toBe(0)
    })
  })
})
