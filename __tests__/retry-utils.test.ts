import { describe, it, expect, afterEach } from 'vitest'
import {
  withRetryFetch,
  withRetryAnthropic,
  withRetry
} from '../src/utils/retry.ts'

function makeRes(
  status: number,
  headers?: Record<string, string>,
  statusText?: string
) {
  return {
    status,
    statusText: statusText ?? `HTTP ${status}`,
    headers: {
      entries: () => Object.entries(headers ?? {})
    }
  } as any
}

describe('withRetryFetch', () => {
  const originalFetch = (globalThis as any).fetch
  let calls = 0

  afterEach(() => {
    ;(globalThis as any).fetch = originalFetch
    calls = 0
  })

  it('retries on 5xx and succeeds', async () => {
    ;(globalThis as any).fetch = async () => {
      calls++
      if (calls <= 2) return makeRes(500)
      return makeRes(200)
    }

    const res = await withRetryFetch('https://example.com', undefined, {
      retries: 3,
      minTimeout: 0,
      maxTimeout: 0
    })
    expect(res.status).toBe(200)
    expect(calls).toBe(3) // initial + 2 retries until success
  })

  it('aborts immediately on 4xx (AbortError) without retry', async () => {
    ;(globalThis as any).fetch = async () => {
      calls++
      return makeRes(404, {}, 'Not Found')
    }

    await expect(
      withRetryFetch('https://example.com', undefined, {
        retries: 5,
        minTimeout: 0,
        maxTimeout: 0
      })
    ).rejects.toThrow(/404|Not Found/i)
    expect(calls).toBe(1)
  })

  it('retries on 429 Too Many Requests', async () => {
    ;(globalThis as any).fetch = async () => {
      calls++
      if (calls <= 2) return makeRes(429, { 'retry-after': '1' })
      return makeRes(200)
    }

    const res = await withRetryFetch('https://example.com', undefined, {
      retries: 3,
      minTimeout: 0,
      maxTimeout: 0
    })
    expect(res.status).toBe(200)
    expect(calls).toBe(3)
  })

  it('retries on network error (no status)', async () => {
    ;(globalThis as any).fetch = async () => {
      calls++
      if (calls <= 1) throw new Error('network down')
      return makeRes(200)
    }

    const res = await withRetryFetch('https://example.com', undefined, {
      retries: 2,
      minTimeout: 0,
      maxTimeout: 0
    })
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
  })
})

describe('withRetryAnthropic', () => {
  it('retries on 5xx and succeeds', async () => {
    let attempts = 0
    const res = await withRetryAnthropic(
      async () => {
        attempts++
        if (attempts <= 2) {
          const e: any = new Error('server error')
          e.status = 500
          throw e
        }
        return { ok: true }
      },
      { retries: 3, minTimeout: 0, maxTimeout: 0 }
    )
    expect(res).toEqual({ ok: true })
    expect(attempts).toBe(3)
  })

  it('aborts on 4xx without retry', async () => {
    let attempts = 0
    await expect(
      withRetryAnthropic(
        async () => {
          attempts++
          const e: any = new Error('bad request')
          e.status = 400
          throw e
        },
        { retries: 3, minTimeout: 0, maxTimeout: 0 }
      )
    ).rejects.toBeInstanceOf(Error)
    expect(attempts).toBe(1)
  })

  it('retries on 429', async () => {
    let attempts = 0
    const out = await withRetryAnthropic(
      async () => {
        attempts++
        if (attempts <= 2) {
          const e: any = new Error('rate limited')
          e.status = 429
          throw e
        }
        return 'ok'
      },
      { retries: 3, minTimeout: 0, maxTimeout: 0 }
    )
    expect(out).toBe('ok')
    expect(attempts).toBe(3)
  })
})

describe('withRetry generic', () => {
  it('preserves status on abort wrapping', async () => {
    let attempts = 0
    await expect(
      withRetry(
        async () => {
          attempts++
          const e: any = new Error('not found')
          e.status = 404
          throw e
        },
        { retries: 2, minTimeout: 0, maxTimeout: 0 }
      )
    ).rejects.toThrow(/404|Not Found/i)
    expect(attempts).toBe(1)
  })
})
