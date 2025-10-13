import * as IORedis from 'ioredis'

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
      password
    })
  }

  async get<T>(key: string): Promise<T | null> {
    const str = await this.client.get(key)
    if (str == null) return null
    try {
      return JSON.parse(str) as T
    } catch {
      // fallback when legacy/plain values exist
      return str as unknown as T
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = 3600
  ): Promise<void> {
    const payload = JSON.stringify(value)
    // EX sets TTL in seconds
    await this.client.set(key, payload, 'EX', ttlSeconds)
  }

  async del(key: string): Promise<void> {
    await this.client.del(key)
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
  }
}

// Singleton instance
let singleton: ComputeCache | null = null

export function getComputeCache(): ComputeCache {
  if (singleton) return singleton

  const url = process.env.REDIS_URL
  if (url) {
    try {
      singleton = new RedisComputeCache(url)
      return singleton
    } catch {
      // Fail open to in-memory if Redis cannot be initialized
      // (Optional: log once to avoid noisy output)
      // console.warn('RedisComputeCache init failed, using in-memory cache', error)
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
 * Not cryptographic; intended for cache keys only.
 */
export function simpleHash(input: string, length: 8 | 16 = 8): string {
  // Fowler–Noll–Vo hash (FNV-1a) 32-bit
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash =
      (hash +
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24)) >>>
      0
  }
  const hex = ('0000000' + hash.toString(16)).slice(-8)
  if (length === 16) {
    // derive a simple 16-char representation by hashing again
    return hex + ('0000000' + simpleRotate(hash).toString(16)).slice(-8)
  }
  return hex
}

function simpleRotate(x: number): number {
  return ((x << 13) | (x >>> 19)) >>> 0
}
