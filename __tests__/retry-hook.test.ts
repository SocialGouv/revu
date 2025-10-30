import { describe, it, expect } from 'vitest'
import { attachOctokitRetry } from '../src/github/retry-hook.ts'

type RequestFn = (options: any) => Promise<any>

function httpError(
  status: number,
  message = `HTTP ${status}`,
  headers?: Record<string, string>
) {
  const e: any = new Error(message)
  e.status = status
  e.statusCode = status
  e.response = { status, statusCode: status, headers: headers ?? {} }
  e.headers = headers ?? {}
  return e
}

class FakeOctokit {
  public hook = {
    wrap: (
      _name: string,
      wrapper: (request: RequestFn, options: any) => Promise<any>
    ) => {
      this._wrapper = wrapper
    }
  }

  // Simulate built-in retry plugin presence when needed
  public retry: any | undefined

  private behavior: RequestFn
  public callCount = 0
  public _wrapper?: (request: RequestFn, options: any) => Promise<any>

  constructor(behavior: RequestFn) {
    this.behavior = async (opts: any) => {
      this.callCount++
      return behavior(opts)
    }
  }

  async request(options: any) {
    const baseRequest: RequestFn = async (opts) => this.behavior(opts)
    if (this._wrapper) {
      return this._wrapper(baseRequest, options)
    }
    return baseRequest(options)
  }
}

describe('attachOctokitRetry hook', () => {
  it('skips attaching when built-in retry plugin is present', async () => {
    const ok = new FakeOctokit(async () => ({ status: 200 }))
    ;(ok as any).retry = {} // simulate @octokit/plugin-retry present

    attachOctokitRetry(ok)

    expect((ok as any)._wrapper).toBeUndefined()
  })

  it('applies read policy for GET with generous retries (succeeds after multiple 5xx)', async () => {
    let attempt = 0
    const ok = new FakeOctokit(async () => {
      attempt++
      if (attempt <= 4) throw httpError(500, 'server error')
      return { status: 200, data: { ok: true } }
    })

    attachOctokitRetry(ok)

    const res = await ok.request({ method: 'GET', url: '/test' })
    expect(res.status).toBe(200)
    // 1 initial + 4 retries = 5 total attempts
    expect(ok.callCount).toBe(5)
  })

  it('applies conservative retries for write policy (POST): only 2 retries', async () => {
    let attempt = 0
    const ok = new FakeOctokit(async () => {
      attempt++
      if (attempt <= 3) throw httpError(500, 'server error')
      return { status: 200, data: { ok: true } }
    })

    attachOctokitRetry(ok)

    // With retries=2 for writes, we expect 3 total attempts and still fail
    await expect(
      ok.request({ method: 'POST', url: '/write' })
    ).rejects.toMatchObject({ status: 500 })
    expect(ok.callCount).toBe(3)
  })

  it('DELETE with revuDeleteTreat404AsSuccess=true returns 204 on 404 (idempotent delete)', async () => {
    const ok = new FakeOctokit(async () => {
      throw httpError(404, 'Not Found')
    })

    attachOctokitRetry(ok)

    const res = await ok.request({
      method: 'DELETE',
      url: '/resource',
      revuDeleteTreat404AsSuccess: true
    })

    expect(res.status).toBe(204)
    expect(res.data).toBeUndefined()
    // 404 is classified abort; wrapper converts to success without retrying
    expect(ok.callCount).toBe(1)
  })

  it('DELETE with revuDeleteTreat404AsSuccess=false throws on 404', async () => {
    const ok = new FakeOctokit(async () => {
      throw httpError(404, 'Not Found')
    })

    attachOctokitRetry(ok)

    await expect(
      ok.request({
        method: 'DELETE',
        url: '/resource',
        revuDeleteTreat404AsSuccess: false
      })
    ).rejects.toThrow(/404|Not Found/)

    expect(ok.callCount).toBe(1)
  })

  it('policy override "none" bypasses retries entirely', async () => {
    const ok = new FakeOctokit(async () => {
      throw httpError(500, 'server error')
    })

    attachOctokitRetry(ok)

    await expect(
      ok.request({
        method: 'GET',
        url: '/no-retry',
        revuRetryPolicy: 'none'
      })
    ).rejects.toMatchObject({ status: 500 })

    expect(ok.callCount).toBe(1)
  })

  it('re-attaching updates context without double-wrapping', async () => {
    const ok = new FakeOctokit(async () => ({ status: 200 }))
    // first attach with some ctx
    attachOctokitRetry(ok, { repository: 'owner1/repo1', pr_number: 1 })
    const firstWrapper = (ok as any)._wrapper
    // re-attach with new ctx; should not replace wrapper
    attachOctokitRetry(ok, { repository: 'owner2/repo2', pr_number: 2 })
    const secondWrapper = (ok as any)._wrapper
    expect(secondWrapper).toBe(firstWrapper)
    // still functions after re-attach
    const res = await ok.request({ method: 'GET', url: '/ping' })
    expect(res.status).toBe(200)
  })
})
