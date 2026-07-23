import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetEntry } from './pet'
import { ShadowContainer } from './shadow'
import { getMessages } from '../i18n'
import { MakeThisBetter } from '../index'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
}))

// PetEntry is kept in the repo for the phase-2 pet mode but is not wired into
// the widget build, so it is unit-tested directly instead of via init().
describe('PetEntry', () => {
  let shadow: ShadowContainer

  afterEach(() => {
    shadow?.destroy()
    document.body.innerHTML = ''
  })

  function makePet(onClick: () => void = () => {}) {
    shadow = new ShadowContainer('light')
    return new PetEntry(shadow, getMessages('en'), onClick)
  }

  function shadowRoot() {
    return document.getElementById('mtb-widget-host')!.shadowRoot!
  }

  it('renders the pet element with a speech bubble', () => {
    makePet()

    expect(shadowRoot().querySelector('.mtb-pet')).toBeTruthy()
    const bubble = shadowRoot().querySelector('.mtb-pet-bubble')
    expect(bubble).toBeTruthy()
    expect(bubble!.textContent).toBe('Need help?')
  })

  it('invokes the click callback on click', () => {
    const onClick = vi.fn()
    makePet(onClick)

    shadowRoot().querySelector<HTMLDivElement>('.mtb-pet')!.click()
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Widget entry', () => {
  afterEach(() => {
    MakeThisBetter.destroy()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders the tab entry and never the pet', () => {
    MakeThisBetter.init({
      projectKey: 'acme',
      apiUrl: 'https://api.example.com/api/v1',
    })

    const shadow = document.getElementById('mtb-widget-host')!.shadowRoot!
    expect(shadow.querySelector('.mtb-tab')).toBeTruthy()
    expect(shadow.querySelector('.mtb-pet')).toBeNull()
  })
})
