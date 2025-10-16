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
const memoryBuckets = new Map<string, { count: number; expiresAt: number }>()
function sweepExpiredBuckets(): void {
  const now = Date.now()
  for (const [key, rec] of memoryBuckets.entries()) {
    if (rec.expiresAt <= now) {
      memoryBuckets.delete(key)
    }
  }
}
function enforceBucketLimit(): void {
  if (memoryBuckets.size <= MAX_MEMORY_BUCKETS) return
  // Remove oldest keys first
  const over = memoryBuckets.size - MAX_MEMORY_BUCKETS
  let removed = 0
  for (const key of memoryBuckets.keys()) {
    memoryBuckets.delete(key)
    removed++
    if (removed >= over) break
  }
}

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = (await client.incr(key)) as any as number
    if (count === 1) {
      await client.expire(key, windowSeconds)
    }
    return { allowed: count <= maxCount, count, limit: maxCount }
  }

  // In-memory fallback
  const now = Date.now()
  const rec = memoryBuckets.get(key)
  if (!rec || rec.expiresAt <= now) {
    memoryBuckets.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1000
    })
    // Opportunistic cleanup to prevent unbounded growth
    if (memoryBuckets.size > MAX_MEMORY_BUCKETS * 1.2) {
      sweepExpiredBuckets()
      enforceBucketLimit()
    }
    return { allowed: 1 <= maxCount, count: 1, limit: maxCount }
  }
  rec.count += 1
  memoryBuckets.set(key, rec)
  // Opportunistic cleanup to prevent unbounded growth
  if (memoryBuckets.size > MAX_MEMORY_BUCKETS * 1.2) {
    sweepExpiredBuckets()
    enforceBucketLimit()
  }
  return { allowed: rec.count <= maxCount, count: rec.count, limit: maxCount }
}
