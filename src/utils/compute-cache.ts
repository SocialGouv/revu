import * as IORedis from 'ioredis'
import { createHash } from 'node:crypto'
import { logSystemWarning } from './logger.ts'

/**
 * Simple compute cache with TTL support.
 * - Default: in-memory singleton Map with expiry.
 * - API is promise-based to allow swapping with Redis or other backends later.
 */

export interface ComputeCache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
  del(key: string): Promise<void>
}

type Entry = {
  value: unknown
  expiresAt: number // epoch ms
}

class InMemoryComputeCache implements ComputeCache {
  private store = new Map<string, Entry>()
  private readonly maxSize: number

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  private evictExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.expiresAt) {
        this.store.delete(key)
      }
    }
  }

  private evictOldest(): void {
    const oldestKey = this.store.keys().next().value
    if (oldestKey) {
      this.store.delete(oldestKey)
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.value as T
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = 3600
  ): Promise<void> {
    // Periodic cleanup of expired entries when approaching capacity
    if (this.store.size > this.maxSize * 0.8) {
      this.evictExpired()
    }

    // Enforce size limit with oldest-first eviction for new keys
    while (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evictOldest()
    }

    const expiresAt = Date.now() + ttlSeconds * 1000
    this.store.set(key, { value, expiresAt })
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  // Internal utility to delete by predicate (used for discussion cache invalidation)
  deleteByPredicate(predicate: (key: string) => boolean): void {
    for (const key of this.store.keys()) {
      if (predicate(key)) {
        this.store.delete(key)
      }
    }
  }
}

class RedisComputeCache implements ComputeCache {
  // Use broad type to maximize compatibility across ESM/CJS environments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any

  constructor(url: string) {
    const tls =
      process.env.REDIS_TLS && process.env.REDIS_TLS.toLowerCase() === 'true'
        ? {}
        : undefined
    const db =
      process.env.REDIS_DB && !Number.isNaN(Number(process.env.REDIS_DB))
        ? Number(process.env.REDIS_DB)
        : undefined
    const password = process.env.REDIS_PASSWORD || undefined

    // ioredis can take URL + options (tls/password/db override URL settings if provided)
    // Support ESM/CJS interop by treating module as a constructor via any cast
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client = new (IORedis as any)(url, {
      ...(tls ? ({ tls } as any) : {}),
      db,
      password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 10000,
      retryStrategy: (times: number) => {
        if (times > 3) return null
        return Math.min(times * 200, 2000)
      }
    })
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const str = await this.client.get(key)
      if (str == null) return null
      try {
        return JSON.parse(str) as T
      } catch {
        // fallback when legacy/plain values exist
        return str as unknown as T
      }
    } catch (error) {
      logSystemWarning(error, {
        context_msg: 'Compute cache: Redis GET failed - treating as cache miss'
      })
      return null
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = 3600
  ): Promise<void> {
    try {
      const payload = JSON.stringify(value)
      // EX sets TTL in seconds
      await this.client.set(key, payload, 'EX', ttlSeconds)
    } catch (error) {
      logSystemWarning(error, {
        context_msg: 'Compute cache: Redis SET failed - skipping cache write'
      })
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (error) {
      logSystemWarning(error, {
        context_msg: 'Compute cache: Redis DEL failed - continuing'
      })
    }
  }

  // Delete discussion keys for a specific reply using SCAN + MATCH
  async deleteByReplyPattern(params: {
    owner: string
    repo: string
    prNumber: number
    replyId: number
  }): Promise<void> {
    const { owner, repo, prNumber, replyId } = params
    const pattern = `discuss|*|${owner}/${repo}|pr${prNumber}|*|reply${replyId}|*`
    let cursor = '0'
    try {
      do {
        const [next, keys] = (await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          1000
        )) as unknown as [string, string[]]
        if (keys && keys.length) {
          const pipeline = this.client.pipeline()
          for (const k of keys) {
            pipeline.del(k)
          }
          await pipeline.exec()
        }
        cursor = next
      } while (cursor !== '0')
    } catch (error) {
      logSystemWarning(error, {
        context_msg:
          'Compute cache: Redis SCAN/DEL failed during cache eviction - continuing'
      })
    }
  }
}

// Singleton instance
let singleton: ComputeCache | null = null

export function getComputeCache(): ComputeCache {
  if (singleton) return singleton

  const url = process.env.REDIS_URL
  const required = (process.env.REDIS_REQUIRED || '').toLowerCase() === 'true'

  if (url) {
    try {
      const redisCache = new RedisComputeCache(url)
      singleton = redisCache

      // Validate connection on startup (best-effort, async). This is advisory only
      // and does not change the selected backend to avoid inconsistent cache usage.
      redisCache.get('__health_check__').catch((err) => {
        const message = err instanceof Error ? err.message : String(err)

        console.error(
          'Redis connection validation failed; continuing with Redis but treating cache as best-effort',
          err
        )

        logSystemWarning(err, {
          context_msg: `Compute cache: Redis health check failed (best-effort) - ${message}`
        })
      })
      return singleton
    } catch (error) {
      if (required) {
        // Fail fast in production-style environments when Redis is mandatory
        throw error
      }

      // Fail open to in-memory if Redis cannot be initialized
      logSystemWarning(error, {
        context_msg:
          'REDIS_URL is set but Redis initialization failed - falling back to in-memory cache (degraded mode)'
      })

      // Additional operator-visible log
      console.warn(
        'RedisComputeCache initialization failed, falling back to in-memory cache:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  singleton = new InMemoryComputeCache()
  return singleton
}

/**
 * Utility to build a discussion cache key.
 * Components should be pre-hashed/normalized by caller where appropriate.
 */
export function buildDiscussionCacheKey(params: {
  owner: string
  repo: string
  prNumber: number
  rootCommentId: number
  lastUserReplyId: number
  lastUserReplyBodyHash: string
  commitSha: string
  model?: string
  strategyVersion?: string
  lastUserReplyLen?: number
  replyVersion?: string // e.g., updated_at timestamp
}): string {
  const {
    owner,
    repo,
    prNumber,
    rootCommentId,
    lastUserReplyId,
    lastUserReplyBodyHash,
    commitSha,
    model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    strategyVersion = 'v1'
  } = params

  return [
    'discuss',
    strategyVersion,
    `${owner}/${repo}`,
    `pr${prNumber}`,
    `root${rootCommentId}`,
    `reply${lastUserReplyId}`,
    `hash:${lastUserReplyBodyHash}`,
    params.lastUserReplyLen !== undefined
      ? `len:${params.lastUserReplyLen}`
      : 'len:-',
    params.replyVersion ? `ver:${params.replyVersion}` : 'ver:-',
    `sha:${commitSha}`,
    `model:${model}`
  ].join('|')
}

export async function evictDiscussionCacheByReply(params: {
  owner: string
  repo: string
  prNumber: number
  replyId: number
}): Promise<void> {
  const { owner, repo, prNumber, replyId } = params
  // Try Redis backend fast-path
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheAny = getComputeCache() as any
  if (typeof cacheAny.deleteByReplyPattern === 'function') {
    await cacheAny.deleteByReplyPattern({ owner, repo, prNumber, replyId })
    return
  }

  // In-memory fallback
  if (typeof cacheAny.deleteByPredicate === 'function') {
    const mustContain = [
      `|${owner}/${repo}|`,
      `|pr${prNumber}|`,
      `|reply${replyId}|`
    ]
    cacheAny.deleteByPredicate((key: string) =>
      mustContain.every((seg: string) => key.includes(seg))
    )
  }
}
/**
 * Small helper to stable-hash a string to hex (8 or 16 chars).
 * Uses SHA-256 for significantly lower collision risk vs FNV-1a.
 */
const DEFAULT_HASH_LENGTH = 16

export function simpleHash(
  input: string,
  length: 8 | 16 = DEFAULT_HASH_LENGTH
): string {
  const full = createHash('sha256').update(input).digest('hex')
  return full.slice(0, length)
}
