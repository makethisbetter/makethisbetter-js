import { afterEach, describe, expect, it, vi } from 'vitest'
import { MakeThisBetter } from '../index'

vi.mock('html-to-image', () => ({
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,/9j/AA=='),
  getFontEmbedCSS: vi.fn(async () => ''),
}))

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
