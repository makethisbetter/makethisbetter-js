import { describe, expect, it, vi } from 'vitest'
import { RecordingManager } from './recording-manager'
import { ShadowContainer } from './shadow'
import { getMessages } from '../i18n'

vi.mock('../record/session', () => {
  return {
    RecordSession: vi.fn().mockImplementation((_shadow: unknown, _onMax: unknown) => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockReturnValue({ events: [{ type: 2 }], duration: 5 }),
      getDuration: vi.fn().mockReturnValue(5),
      destroy: vi.fn(),
    })),
  }
})

vi.mock('../record/control-bar', () => {
  return {
    RecordControlBar: vi.fn().mockImplementation(() => ({
      destroy: vi.fn(),
    })),
  }
})

function setup() {
  const shadow = new ShadowContainer()
  const messages = getMessages('en')
  const manager = new RecordingManager()
  const onStop = vi.fn()

  return { shadow, messages, manager, onStop }
}

describe('RecordingManager', () => {
  it('getRecording returns null before start', () => {
    const { manager } = setup()

    expect(manager.getRecording()).toBeNull()
  })

  it('start creates session and control bar', async () => {
    const { shadow, messages, manager, onStop } = setup()

    await manager.start(shadow, messages, onStop)

    const { RecordSession } = await import('../record/session')
    const { RecordControlBar } = await import('../record/control-bar')
    expect(RecordSession).toHaveBeenCalledWith(shadow, onStop)
    expect(RecordControlBar).toHaveBeenCalledWith(
      shadow,
      messages,
      expect.any(Function),
      onStop,
    )

    manager.destroy()
    shadow.destroy()
  })

  it('stop returns recording result', async () => {
    const { shadow, messages, manager, onStop } = setup()

    await manager.start(shadow, messages, onStop)
    const result = manager.stop()

    expect(result).toEqual({ events: [{ type: 2 }], duration: 5 })

    shadow.destroy()
  })

  it('getRecording returns result after stop', async () => {
    const { shadow, messages, manager, onStop } = setup()

    await manager.start(shadow, messages, onStop)
    manager.stop()

    expect(manager.getRecording()).toEqual({ events: [{ type: 2 }], duration: 5 })

    shadow.destroy()
  })

  it('stop returns null if never started', () => {
    const { manager } = setup()

    expect(manager.stop()).toBeNull()
  })

  it('destroy clears the recording result', async () => {
    const { shadow, messages, manager, onStop } = setup()

    await manager.start(shadow, messages, onStop)
    manager.stop()
    expect(manager.getRecording()).toBeTruthy()

    manager.destroy()
    expect(manager.getRecording()).toBeNull()

    shadow.destroy()
  })

  it('destroy cleans up session and bar', async () => {
    const { shadow, messages, manager, onStop } = setup()

    await manager.start(shadow, messages, onStop)

    const { RecordSession } = await import('../record/session')
    const sessionInstance = (RecordSession as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    const { RecordControlBar } = await import('../record/control-bar')
    const barInstance = (RecordControlBar as unknown as ReturnType<typeof vi.fn>).mock.results[0].value

    manager.destroy()

    expect(sessionInstance.destroy).toHaveBeenCalled()
    expect(barInstance.destroy).toHaveBeenCalled()

    shadow.destroy()
  })

  it('stop cleans up session and bar UI', async () => {
    const { shadow, messages, manager, onStop } = setup()

    await manager.start(shadow, messages, onStop)

    const { RecordSession } = await import('../record/session')
    const sessionInstance = (RecordSession as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    const { RecordControlBar } = await import('../record/control-bar')
    const barInstance = (RecordControlBar as unknown as ReturnType<typeof vi.fn>).mock.results[0].value

    manager.stop()

    expect(sessionInstance.destroy).toHaveBeenCalled()
    expect(barInstance.destroy).toHaveBeenCalled()

    shadow.destroy()
  })
})
