import { logger, redact } from '@/lib/logger'
import { describe, expect, it, vi } from 'vitest'

describe('logger recursive redaction', () => {
  it('masks top-level API keys and tokens', () => {
    const output = redact({
      apiKey: 'sk-1234567890abcdef',
      token: 'secret-token-xyz',
      provider: 'openai',
    })

    expect(output.provider).toBe('openai')
    expect(output.apiKey).toBe('••••cdef')
    expect(output.token).toBe('••••-xyz')
  })

  it('masks nested credentials inside objects and arrays', () => {
    const output = redact({
      engine: {
        provider: 'openai',
        apiKey: 'sk-abcdef123456',
        params: {
          authorization: 'Bearer supersecret',
        },
      },
      seats: [
        { label: 'Player 1', api_key: 'sk-player1key999' },
        { label: 'Player 2', normalField: 'clean' },
      ],
    })

    const engine = output.engine as Record<string, unknown>
    const params = engine.params as Record<string, unknown>
    const seats = output.seats as Array<Record<string, unknown>>

    expect(engine.provider).toBe('openai')
    expect(engine.apiKey).toBe('••••3456')
    expect(params.authorization).toBe('••••cret')
    expect(seats[0].api_key).toBe('••••y999')
    expect(seats[1].normalField).toBe('clean')
  })

  it('handles circular references safely without crashing', () => {
    const circularObj: Record<string, unknown> = {
      name: 'root',
      apiKey: 'sk-circular-key-1234',
    }
    circularObj.self = circularObj

    const output = redact(circularObj)
    expect(output.name).toBe('root')
    expect(output.apiKey).toBe('••••1234')
    expect(output.self).toBe('[circular]')
  })

  it('calls console with redacted payload', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logger.info('test message', { apiKey: 'sk-live-secret-test' })

    expect(spy).toHaveBeenCalledWith('[ai-backgammon]', 'test message', {
      apiKey: '••••test',
    })
    spy.mockRestore()
  })
})

