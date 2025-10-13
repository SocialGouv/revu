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

/**
 * Per-instance state: whether our wrapper is attached and the latest context.
 * Using WeakMap so we can update ctx for a reused Octokit instance without re-wrapping.
 */
const instanceState = new WeakMap<HasHook, { hasWrapper: boolean; ctx?: Ctx }>()

const isTest =
  process.env.NODE_ENV === 'test' || process.env.VITEST_WORKER_ID != null

export function attachOctokitRetry<T extends HasHook>(
  octokit: T,
  ctx?: Ctx,
  opts?: { force?: boolean }
): T {
  // Ensure per-instance state and update context
  const existing = instanceState.get(octokit)
  if (existing) {
    if (ctx) existing.ctx = ctx
  } else {
    instanceState.set(octokit, { hasWrapper: false, ctx })
  }

  const anyOcto = octokit as any

  // If Octokit already has a built-in retry plugin, skip our wrapper to avoid double-wrapping
  if (anyOcto && typeof anyOcto.retry !== 'undefined') {
    return octokit
  }

  // If already wrapped and not forcing, do not re-wrap; wrapper reads ctx dynamically.
  if (instanceState.get(octokit)?.hasWrapper && !opts?.force) {
    return octokit
  }

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
      const pick = (e: any) => {
        const candidates = [
          e?.status,
          e?.response?.status,
          e?.statusCode,
          e?.response?.statusCode
        ]
        for (const val of candidates) {
          const n = Number(val)
          if (Number.isFinite(n)) return n
        }
        return undefined
      }
      return pick(err) ?? (err?.cause ? pick(err.cause) : undefined)
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
          if (st === 404 || st === 410) {
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
        repository: instanceState.get(octokit)?.ctx?.repository,
        pr_number: instanceState.get(octokit)?.ctx?.pr_number
      },
      retries,
      minTimeout,
      maxTimeout
    })
    return res
  })

  // Mark wrapper as attached for this instance
  const s = instanceState.get(octokit)
  if (s) s.hasWrapper = true

  return octokit
}
