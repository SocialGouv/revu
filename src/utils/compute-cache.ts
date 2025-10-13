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

// Singleton instance
let singleton: ComputeCache | null = null

export function getComputeCache(): ComputeCache {
  if (singleton) return singleton

  // In the future, we can add a REDIS_URL-based implementation here.
  // For now, use in-memory cache by default.
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
  // Access internal deleteByPredicate if available (in-memory cache)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheAny = getComputeCache() as any
  if (typeof cacheAny.deleteByPredicate === 'function') {
    const mustContain = [
      `|${owner}/${repo}|`,
      `|pr${prNumber}|`,
      `|reply${replyId}|`
    ]
    cacheAny.deleteByPredicate((key: string) =>
      mustContain.every((seg) => key.includes(seg))
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
