import pRetry, { AbortError, type Options as PRetryOptions } from 'p-retry'
import { logSystemWarning } from './logger.ts'
import { getRuntimeConfigSync } from '../core/utils/runtime-config.ts'

const runtime = getRuntimeConfigSync()
const isTest = runtime.system.isTest

type RetryLogContext = {
  operation: string
  pr_number?: number
  repository?: string
}

export interface WithRetryOptions extends Partial<PRetryOptions> {
  context?: RetryLogContext
  shouldAbort?: (error: unknown) => boolean
}

const defaultOptions: Partial<PRetryOptions> = {
  retries:
    runtime.system.pRetryRetries != null
      ? runtime.system.pRetryRetries
      : isTest
        ? 1
        : 5,
  factor: 2,
  minTimeout: isTest ? 0 : 500,
  maxTimeout: isTest ? 0 : 5000,
  randomize: !isTest
}

function coerceStatus(val: any): number | undefined {
  if (val === undefined || val === null) return undefined
  const n = Number(val)
  return Number.isFinite(n) ? n : undefined
}

export function getStatus(err: any): number | undefined {
  if (!err || typeof err !== 'object') return undefined

  // Handle shapes from Octokit/axios/fetch-like wrappers and coerce to number
  const raw =
    err.status ??
    err.response?.status ??
    err.response?.statusCode ??
    err.statusCode ??
    err.cause?.status ??
    err.cause?.response?.status
  return coerceStatus(raw)
}

function getHeaders(err: any): Record<string, string> | undefined {
  // Normalize to a plain object of lower-cased header names
  let headers = err?.headers ?? err?.response?.headers

  // Handle Headers object (like from fetch)
  if (!headers && err?.response?.headers?.get && err?.response?.headers?.keys) {
    try {
      headers = Object.fromEntries(
        Array.from(err.response.headers.keys()).map((k: string) => [
          k,
          err.response.headers.get(k) as string
        ])
      )
    } catch {
      headers = undefined
    }
  }

  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = String(v)
  }
  return out
}

function errorToMessage(err: any): string {
  const msg = err?.message ?? String(err)
  const status = getStatus(err)
  return status ? `[${status}] ${msg}` : msg
}

function shouldAbortDefault(err: any): boolean {
  const status = getStatus(err)
  const headers = getHeaders(err) || {}

  // Retry-after and rate limit handling
  if (status === 429) return false // always retry Too Many Requests

  if (status === 403) {
    const retryAfter = headers['retry-after']
    const remaining = headers['x-ratelimit-remaining']
    if (retryAfter || remaining === '0') return false // rate limited -> retry
    return true // other 403s likely auth/permission -> abort
  }

  if (status == null) return false // network/unknown -> retry
  if (status >= 500) return false // 5xx -> retry
  if (status >= 400 && status < 500) return true // other 4xx -> abort
  return false
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
): Promise<T> {
  const { context, shouldAbort, ...retryOpts } = options

  return pRetry(
    async () => {
      try {
        return await fn()
      } catch (err) {
        const abort = shouldAbort ? shouldAbort(err) : shouldAbortDefault(err)
        if (abort) {
          const abortErr: any = new AbortError(errorToMessage(err))
          // Preserve original useful fields for downstream error handling (e.g., Octokit)
          // Always attach an HTTP status if we can derive it
          const status = getStatus(err)
          if (status !== undefined) abortErr.status = status

          const orig: any = err
          if (orig && typeof orig === 'object') {
            // Only copy response and headers for API error compatibility
            if (orig.response !== undefined) abortErr.response = orig.response
            if (orig.headers !== undefined) abortErr.headers = orig.headers
          }

          // Attach original error as cause for debugging
          abortErr.cause = err
          throw abortErr
        }
        if (!(err instanceof Error)) {
          const wrap: any = new Error(errorToMessage(err))
          // Always attach derived HTTP status if available
          const status = getStatus(err)
          if (status !== undefined) wrap.status = status
          try {
            const orig: any = err
            if (orig) {
              if (orig.response !== undefined) wrap.response = orig.response
              if (orig.headers !== undefined) wrap.headers = orig.headers
              if (orig.code !== undefined) wrap.code = orig.code
              const origCtorName = orig?.constructor?.name
              if (orig.name) wrap.originalName = orig.name
              if (origCtorName) wrap.originalConstructorName = origCtorName
              if (orig.stack && !wrap.stack) {
                wrap.stack = orig.stack
              }
            }
            wrap.cause = err
            wrap.originalError = err
          } catch {
            /* noop */
          }
          throw wrap
        }
        throw err
      }
    },
    {
      ...defaultOptions,
      ...retryOpts,
      onFailedAttempt: (err) => {
        if (isTest) return
        const attemptNumber = err?.attemptNumber ?? 0
        const retriesLeft = err?.retriesLeft ?? 0
        const msg = (err as any)?.message ?? String(err)
        try {
          logSystemWarning(
            new Error(
              `[retry] ${context?.operation ?? 'operation'} failed (attempt ${attemptNumber}, retries left ${retriesLeft}): ${msg}`
            ),
            {
              pr_number: context?.pr_number,
              repository: context?.repository,
              context_msg: 'Network/API call retry'
            }
          )
        } catch {
          // noop in tests or partial mocks
        }
      }
    }
  )
}

export async function withRetryOctokit<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
) {
  return withRetry(fn, {
    ...options,
    shouldAbort: (err) => {
      const status = getStatus(err)
      const headers = getHeaders(err) || {}
      if (status === 429) return false
      if (status === 403) {
        const retryAfter = headers['retry-after']
        const remaining = headers['x-ratelimit-remaining']
        if (retryAfter || remaining === '0') return false
        return true
      }
      if (status == null) return false
      if (status >= 500) return false
      if (status >= 400 && status < 500) return true
      return false
    }
  })
}

export async function withRetryAnthropic<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
) {
  return withRetry(fn, {
    ...options,
    shouldAbort: (err) => {
      const status = getStatus(err)
      if (status === 429) return false
      if (status == null) return false
      if (status >= 500) return false
      if (status >= 400 && status < 500) return true
      return false
    }
  })
}

/**
 * Wrapper for fetch calls with retry semantics.
 * Using loose types to avoid relying on DOM lib types in Node.js
 */
export async function withRetryFetch(
  input: any,
  init?: any,
  options?: WithRetryOptions
) {
  return withRetry(
    async () => {
      // Use global fetch (Node 18+)
      const res: Response = await globalThis.fetch(input, init)
      if (res.status === 429 || res.status >= 500) {
        const e: any = new Error(`HTTP ${res.status}`)
        e.status = res.status
        e.headers = Object.fromEntries(res.headers.entries())
        throw e
      }
      if (res.status >= 400 && res.status < 500) {
        const e: any = new AbortError(res.statusText || `HTTP ${res.status}`)
        e.status = res.status
        e.headers = Object.fromEntries(res.headers.entries())
        throw e
      }
      return res
    },
    {
      ...(options || {})
    }
  )
}

export { AbortError }
