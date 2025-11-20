import * as IORedis from 'ioredis'
import { logSystemWarning } from './logger.ts'

type RedisClient = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any

let redisClient: RedisClient | null = null

function getRedis(): RedisClient | null {
  if (redisClient !== null) return redisClient
  const url = process.env.REDIS_URL
  if (!url) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redisClient = new (IORedis as any)(url, {
      db:
        process.env.REDIS_DB && !Number.isNaN(Number(process.env.REDIS_DB))
          ? Number(process.env.REDIS_DB)
          : undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(process.env.REDIS_TLS === 'true' ? ({ tls: {} } as any) : {})
    })
    return redisClient
  } catch (error) {
    logSystemWarning(error, {
      context_msg:
        'Rate limiter: REDIS_URL is set but failed to initialize Redis - falling back to in-memory limiter (degraded mode)'
    })
    redisClient = null
    return null
  }
}

const MAX_MEMORY_BUCKETS = 10000
const CLEANUP_INTERVAL_MS = 300_000 // 5 minutes

type MemoryBucket = {
  count: number
  expiresAt: number
  lastAccess: number
}

class RateLimitMemoryStore {
  private buckets = new Map<string, MemoryBucket>()
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor(private readonly maxSize: number = MAX_MEMORY_BUCKETS) {
    this.cleanupInterval = setInterval(
      () => this.sweepExpired(),
      CLEANUP_INTERVAL_MS
    )
    // Do not keep the Node.js process alive just for cleanup
    ;(this.cleanupInterval as any).unref?.()
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const [key, rec] of this.buckets.entries()) {
      if (rec.expiresAt <= now) {
        this.buckets.delete(key)
      }
    }
  }

  private evictLRU(): void {
    if (this.buckets.size <= this.maxSize) return

    let oldestKey: string | null = null
    let oldestAccess = Infinity

    for (const [key, rec] of this.buckets.entries()) {
      if (rec.lastAccess < oldestAccess) {
        oldestAccess = rec.lastAccess
        oldestKey = key
      }
    }

    if (oldestKey !== null) {
      this.buckets.delete(oldestKey)
    }
  }

  increment(key: string, windowSeconds: number, now: number): number {
    const existing = this.buckets.get(key)
    let rec: MemoryBucket

    if (!existing || existing.expiresAt <= now) {
      rec = {
        count: 1,
        expiresAt: now + windowSeconds * 1000,
        lastAccess: now
      }
    } else {
      rec = {
        ...existing,
        count: existing.count + 1,
        lastAccess: now
      }
    }

    this.buckets.set(key, rec)

    if (this.buckets.size > this.maxSize) {
      this.evictLRU()
    }

    return rec.count
  }
}

const memoryStore = new RateLimitMemoryStore()

export function getRateLimitConfig(): {
  maxCount: number
  windowSeconds: number
} {
  const max = Number(process.env.REPLIES_PER_WINDOW || '10')
  const win = Number(process.env.RATE_WINDOW_SECONDS || '3600')
  return {
    maxCount: Number.isNaN(max) ? 10 : max,
    windowSeconds: Number.isNaN(win) ? 3600 : win
  }
}

/**
 * Increments the rate counter and returns whether the action is allowed.
 * Keyed by repo/PR/user with a windowed counter.
 */
export async function checkAndConsumeRateLimit(params: {
  owner: string
  repo: string
  prNumber: number
  username: string
  maxCount?: number
  windowSeconds?: number
}): Promise<{
  allowed: boolean
  count: number
  limit: number
}> {
  const { owner, repo, prNumber, username } = params
  const { maxCount, windowSeconds } = {
    ...getRateLimitConfig(),
    ...('maxCount' in params ? { maxCount: params.maxCount } : {}),
    ...('windowSeconds' in params
      ? { windowSeconds: params.windowSeconds }
      : {})
  }

  const key = `rate|${owner}/${repo}|pr${prNumber}|user:${username}`

  const client = getRedis()
  if (client) {
    // Redis fast path with INCR + EXPIRE on first increment

    const count = (await client.incr(key)) as number
    if (count === 1) {
      await client.expire(key, windowSeconds)
    }
    return { allowed: count <= maxCount, count, limit: maxCount }
  }

  // In-memory fallback with bounded LRU cache
  const now = Date.now()
  const count = memoryStore.increment(key, windowSeconds, now)
  return { allowed: count <= maxCount, count, limit: maxCount }
}
