import { withRetryOctokit } from '../utils/retry.ts'

type Ctx = {
  repository?: string
  pr_number?: number
}

/**
 * Globally attaches a p-retry wrapper to all Octokit requests for a given instance.
 * This reduces per-call verbosity by centralizing retry logic.
 *
 * Important: Do not also wrap individual calls with withRetryOctokit when using this,
 * to avoid double-wrapping and nested retries.
 */
type HasHook = {
  hook: {
    wrap: (
      name: string,
      wrapper: (request: any, options: any) => Promise<any>
    ) => void
  }
}

// Track instances that already have retry attached
const attachedInstances = new WeakSet<HasHook>()

const isTest =
  process.env.NODE_ENV === 'test' || process.env.VITEST_WORKER_ID != null

export function attachOctokitRetry<T extends HasHook>(
  octokit: T,
  ctx?: Ctx
): T {
  // Avoid attaching twice
  if (attachedInstances.has(octokit)) {
    return octokit
  }

  const anyOcto = octokit as any

  // If Octokit already has a built-in retry plugin, skip our wrapper to avoid double-wrapping
  if (anyOcto && typeof anyOcto.retry !== 'undefined') {
    attachedInstances.add(octokit)
    return octokit
  }

  attachedInstances.add(octokit)

  // Wrap the base request pipeline
  anyOcto.hook.wrap('request', async (request: any, options: any) => {
    const method = (options?.method || 'GET').toString().toUpperCase()
    const url = options?.url || ''
    const operation = `${method} ${url}`

    // Determine policy (defaults)
    let retries = 5
    let minTimeout = 500
    let maxTimeout = 5000

    const policyOverride = options?.revuRetryPolicy as
      | 'default'
      | 'read'
      | 'write'
      | 'delete'
      | 'none'
      | undefined

    const treatDelete404AsSuccess =
      options?.revuDeleteTreat404AsSuccess !== undefined
        ? Boolean(options.revuDeleteTreat404AsSuccess)
        : false

    const statusOf = (err: any): number | undefined => {
      const raw =
        err?.status ??
        err?.response?.status ??
        err?.statusCode ??
        err?.response?.statusCode
      const n = Number(raw)
      if (Number.isFinite(n)) return n
      const msg = String(err?.message ?? '')
      const m = msg.match(/(\d{3})/)
      if (m) {
        const code = Number(m[1])
        if (code >= 400 && code < 600) return code
      }
      return undefined
    }

    // Map override or method to effective policy
    const effective =
      policyOverride && policyOverride !== 'default'
        ? policyOverride
        : method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
          ? 'read'
          : method === 'DELETE'
            ? 'delete'
            : 'write'

    if (effective === 'none') {
      // Bypass retries for this call explicitly
      return request(options)
    }

    // For writes/deletes, use conservative retry/backoff to avoid duplication/rate churn.
    if (effective === 'write' || effective === 'delete') {
      retries = 2
      minTimeout = 1000
      maxTimeout = 2000
    }

    if (isTest) {
      minTimeout = 0
      maxTimeout = 0
    }

    // Build a runner that converts DELETE 404/410 into success immediately (no retry)
    const runner = async () => {
      try {
        return await request(options)
      } catch (err) {
        if (effective === 'delete' && treatDelete404AsSuccess) {
          const st = statusOf(err) ?? statusOf((err as any)?.cause)
          const msg = String((err as any)?.message ?? '')
          if (st === 404 || st === 410 || /\b(404|410)\b/.test(msg)) {
            return {
              status: 204,
              data: undefined
            }
          }
        }
        throw err
      }
    }

    // Use default withRetryOctokit classification which:
    // - Retries 5xx, 429, and network errors
    // - For 403: retries when rate-limited (Retry-After or remaining=0), otherwise aborts
    // - Aborts other 4xx
    const res = await withRetryOctokit(runner, {
      context: {
        operation,
        repository: ctx?.repository,
        pr_number: ctx?.pr_number
      },
      retries,
      minTimeout,
      maxTimeout
    })
    return res
  })

  return octokit
}
