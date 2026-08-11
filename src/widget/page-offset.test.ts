import { afterEach, describe, it, expect } from 'vitest'
import { PageOffset } from './page-offset'

describe('PageOffset', () => {
  afterEach(() => {
    document.body.removeAttribute('style')
  })

  it('pushes the page down by the space the bar needs', () => {
    const offset = new PageOffset()
    offset.reserve(100)

    expect(document.body.style.paddingTop).toBe('100px')
  })

  // The page may already be padding its own content away from the top; the bar
  // needs room in addition to that, not instead of it.
  it('adds to the padding the page already had', () => {
    document.body.style.paddingTop = '20px'

    const offset = new PageOffset()
    offset.reserve(100)

    expect(document.body.style.paddingTop).toBe('120px')
  })

  it('puts the page author’s own value back, not an empty string', () => {
    document.body.style.paddingTop = '20px'

    const offset = new PageOffset()
    offset.reserve(100)
    offset.release()

    expect(document.body.style.paddingTop).toBe('20px')
  })

  it('leaves no inline padding behind when the page had none', () => {
    const offset = new PageOffset()
    offset.reserve(100)
    offset.release()

    expect(document.body.style.paddingTop).toBe('')
  })

  // A site that animates its own layout would otherwise slide its content down
  // as the bar appears, which reads as the widget breaking the page.
  it('suppresses the page’s own transition while the space is held', () => {
    document.body.style.transition = 'padding 300ms ease'

    const offset = new PageOffset()
    offset.reserve(100)
    expect(document.body.style.transition).toBe('none')

    offset.release()
    expect(document.body.style.transition).toBe('padding 300ms ease')
  })

  it('is idempotent: reserving twice does not stack', () => {
    const offset = new PageOffset()
    offset.reserve(100)
    offset.reserve(100)

    expect(document.body.style.paddingTop).toBe('100px')
  })

  it('releasing without reserving is a no-op', () => {
    document.body.style.paddingTop = '20px'

    new PageOffset().release()

    expect(document.body.style.paddingTop).toBe('20px')
  })

  it('does nothing when there is no bar to make room for', () => {
    const offset = new PageOffset()
    offset.reserve(0)

    expect(document.body.style.paddingTop).toBe('')
    expect(offset.isApplied()).toBe(false)
  })
})
