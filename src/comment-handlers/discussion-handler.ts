import type { PlatformContext } from '../core/models/platform-types.ts'
import { buildReviewContext } from '../prompt-strategies/build-review-context.ts'
import { buildDiscussionPromptSegments } from '../prompt-strategies/build-discussion-prompt-segments.ts'
import { getDiscussionSender } from '../senders/index.ts'
import {
  buildDiscussionCacheKey,
  getComputeCache,
  simpleHash
} from '../utils/compute-cache.ts'
import { logSystemError, logSystemWarning } from '../utils/logger.ts'

export interface ThreadMessage {
  author: string
  body: string
}

export interface DiscussionHandlerParams {
  platformContext: PlatformContext
  prNumber: number
  repositoryUrl: string
  branch: string
  parentCommentId: number
  parentCommentBody: string
  userReplyCommentId: number
  userReplyBody: string
  owner: string
  repo: string
  commitSha?: string
  history?: ThreadMessage[]
  cacheTtlSeconds?: number
  replyVersion?: string
  // Optional scoping and threading details
  relevantFilePath?: string
  diffHunk?: string
  rootCommentId?: number
}

type ReviewCommentSnapshot = {
  id: number
  body: string
  updated_at?: string
}

/**
 * Handles a discussion reply:
 * - Rebuilds the same review context (diff, files, guidelines, issues)
 * - Generates a concise response to the user's message
 * - Posts a threaded reply to the review comment
 * - Uses a compute cache to avoid duplicate work
 */
const MAX_REPLY_PROMPT_CHARS = 4000
const MAX_REPLY_HASH_CHARS = 8192

function isExploitableDiscussionReply(
  reply: string,
  userReplyBody: string
): boolean {
  const trimmed = reply.trim()
  if (!trimmed) return false

  // Require a minimum length so we avoid trivial or one-word replies
  if (trimmed.length < 40) return false

  // Avoid replies that simply echo the user message
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalize(trimmed) === normalize(userReplyBody)) return false

  // Heuristic: require at least one period to hint at a full sentence
  if (!trimmed.includes('.')) return false

  return true
}

export async function handleDiscussionReply(params: DiscussionHandlerParams) {
  const {
    platformContext,
    prNumber,
    repositoryUrl,
    branch,
    parentCommentId,
    parentCommentBody,
    userReplyCommentId,
    userReplyBody,
    owner,
    repo,
    history = [],
    cacheTtlSeconds = 3600,
    replyVersion,
    relevantFilePath,
    diffHunk,
    rootCommentId
  } = params

  // Validate required parameters
  if (!prNumber || prNumber <= 0) {
    throw new Error('Invalid PR number')
  }
  if (!parentCommentId || parentCommentId <= 0) {
    throw new Error('Invalid parent comment ID')
  }
  if (!userReplyCommentId || userReplyCommentId <= 0) {
    throw new Error('Invalid user reply comment ID')
  }
  if (!userReplyBody?.trim()) {
    throw new Error('User reply body cannot be empty')
  }

  // Build review context (shared with main review flow)
  const reviewCtx = await buildReviewContext(
    repositoryUrl,
    branch,
    platformContext
  )

  // Cache key built from stable inputs
  const cache = getComputeCache()
  const replyLen = userReplyBody.length
  const truncatedForHash =
    replyLen > MAX_REPLY_HASH_CHARS
      ? userReplyBody.slice(0, MAX_REPLY_HASH_CHARS)
      : userReplyBody
  const bodyHash = simpleHash(truncatedForHash, 16)
  const provider = process.env.LLM_PROVIDER || 'anthropic'
  const modelForKey =
    provider === 'openai'
      ? process.env.OPENAI_MODEL || 'gpt-5'
      : process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'
  const cacheKey = buildDiscussionCacheKey({
    owner,
    repo,
    prNumber,
    rootCommentId: rootCommentId ?? parentCommentId,
    lastUserReplyId: userReplyCommentId,
    lastUserReplyBodyHash: bodyHash,
    commitSha: reviewCtx.commitSha,
    model: `${provider}:${modelForKey}`,
    strategyVersion: 'v1',
    lastUserReplyLen: replyLen,
    replyVersion
  })

  // Try cache
  const cachedBody = await cache.get<string>(cacheKey)
  if (cachedBody) {
    // Idempotency: cached entries are only written after a successful post.
    // To avoid duplicate replies on webhook redelivery, do not post again.
    try {
      const currentAfter = (await platformContext.client.getReviewComment(
        userReplyCommentId
      )) as ReviewCommentSnapshot
      if (currentAfter == null) {
        logSystemWarning(
          'Review comment lookup failed during cached stale check; treating as transient error',
          {
            pr_number: prNumber,
            repository: `${owner}/${repo}`,
            context_msg:
              'getReviewComment returned null while validating cached discussion reply'
          }
        )
        throw new Error(
          'Transient: failed to fetch review comment for stale check (cached)'
        )
      }
      if (
        currentAfter.body !== userReplyBody ||
        (replyVersion && currentAfter.updated_at !== replyVersion)
      ) {
        logSystemWarning(
          'Stale reply detected before returning cached discussion reply - discarding result',
          {
            pr_number: prNumber,
            repository: `${owner}/${repo}`,
            context_msg:
              'User edited reply during processing; not returning potentially stale cached response'
          }
        )
        return 'stale_skipped'
      }
      // Return cached response without re-posting
      return cachedBody
    } catch (error) {
      logSystemError(error, {
        pr_number: prNumber,
        repository: `${owner}/${repo}`,
        context_msg: 'Failed to validate cached discussion reply state'
      })
      throw error
    }
  }

  // Optional best-effort distributed lock to avoid duplicate generation
  const lockKey = `discuss|lock|${cacheKey}`
  const cacheAny = cache as unknown as {
    tryAcquireLock?: (key: string, ttlSeconds?: number) => Promise<boolean>
    releaseLock?: (key: string) => Promise<void>
  }
  const hasLockSupport =
    typeof cacheAny.tryAcquireLock === 'function' &&
    typeof cacheAny.releaseLock === 'function'

  let acquired = false
  if (hasLockSupport) {
    const lockTtl = Number(process.env.DISCUSSION_LOCK_TTL_SECONDS || 240)
    acquired = await cacheAny.tryAcquireLock(lockKey, lockTtl)
  }

  // If another worker holds the lock, wait briefly for it to populate the cache
  if (hasLockSupport && !acquired) {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      const body = await cache.get<string>(cacheKey)
      if (body) {
        try {
          const currentAfter = (await platformContext.client.getReviewComment(
            userReplyCommentId
          )) as ReviewCommentSnapshot
          if (currentAfter == null) {
            logSystemWarning(
              'Review comment lookup failed while waiting for lock holder; treating as transient error',
              {
                pr_number: prNumber,
                repository: `${owner}/${repo}`,
                context_msg:
                  'getReviewComment returned null while validating cached discussion reply during lock wait'
              }
            )
            throw new Error(
              'Transient: failed to fetch review comment for stale check (lock-wait cached)'
            )
          }
          if (
            currentAfter.body !== userReplyBody ||
            (replyVersion && currentAfter.updated_at !== replyVersion)
          ) {
            logSystemWarning(
              'Stale reply detected before posting cached discussion reply - discarding result',
              {
                pr_number: prNumber,
                repository: `${owner}/${repo}`,
                context_msg:
                  'User edited reply during processing; not posting potentially stale cached response'
              }
            )
            return 'stale_skipped'
          }
        } catch (error) {
          logSystemError(error, {
            pr_number: prNumber,
            repository: `${owner}/${repo}`,
            context_msg:
              'Failed to validate cached discussion reply state while waiting for lock holder'
          })
          throw error
        }

        return body
      }
    }

    // No cached body appeared; attempt to take over the lock. If successful,
    // fall through into the normal generation path as the new lock holder.
    const reacquired = await cacheAny.tryAcquireLock?.(lockKey, 30)
    if (reacquired) {
      acquired = true
    } else {
      logSystemWarning(
        'Discussion reply generation skipped because another worker still holds the lock after extended wait',
        {
          pr_number: prNumber,
          repository: `${owner}/${repo}`,
          context_msg:
            'Avoiding duplicate discussion replies under concurrency; no cached body available after waiting and lock could not be reacquired'
        }
      )
      return 'lock_skipped'
    }
  }

  // Build concise discussion prompt. Re-include the same context as review.
  const replyForPrompt =
    replyLen > MAX_REPLY_PROMPT_CHARS
      ? userReplyBody.slice(0, MAX_REPLY_PROMPT_CHARS)
      : userReplyBody

  const segments = buildDiscussionPromptSegments({
    reviewCtx,
    parentCommentBody,
    userReplyBody: replyForPrompt,
    history,
    relevantFilePath,
    diffHunk
  })

  // Generate assistant reply (concise)
  let reply: string
  try {
    const sender = await getDiscussionSender()
    reply = await sender(segments)
  } catch (error) {
    if (acquired && hasLockSupport) {
      await cacheAny.releaseLock!(lockKey).catch(() => {})
    }
    logSystemError(error, {
      pr_number: prNumber,
      repository: `${owner}/${repo}`,
      context_msg: 'Failed to generate discussion reply'
    })
    throw error
  }

  // Post threaded reply under the user's comment (with stale-guard)
  try {
    const currentAfter = (await platformContext.client.getReviewComment(
      userReplyCommentId
    )) as ReviewCommentSnapshot
    if (currentAfter == null) {
      logSystemWarning(
        'Review comment lookup failed before posting discussion reply; treating as transient error',
        {
          pr_number: prNumber,
          repository: `${owner}/${repo}`,
          context_msg:
            'getReviewComment returned null while performing post-generation stale check'
        }
      )
      throw new Error(
        'Transient: failed to fetch review comment for stale check (post-generation)'
      )
    }
    if (
      currentAfter.body !== userReplyBody ||
      (replyVersion && currentAfter.updated_at !== replyVersion)
    ) {
      logSystemWarning(
        'Stale reply detected after generation - discarding result',
        {
          pr_number: prNumber,
          repository: `${owner}/${repo}`,
          context_msg:
            'User edited reply during processing; not posting or caching potentially stale response'
        }
      )
      return 'stale_skipped'
    }

    const trimmedReply = reply?.trim() ?? ''

    if (!isExploitableDiscussionReply(trimmedReply, userReplyBody)) {
      const fallbackReply =
        'I could not generate a confident, useful automated reply for this discussion message. '
        + 'Please clarify your question or add more context if you would like a more detailed follow-up.'

      logSystemWarning(
        'Non-exploitable discussion reply generated - using fallback',
        {
          pr_number: prNumber,
          repository: `${owner}/${repo}`,
          context_msg:
            'Discussion LLM reply was too short, uninformative, or echoed the user; posting generic fallback instead.'
        }
      )

      await platformContext.client.replyToReviewComment(
        prNumber,
        userReplyCommentId,
        fallbackReply
      )

      await cache.set(cacheKey, fallbackReply, cacheTtlSeconds)
      return fallbackReply
    }

    await platformContext.client.replyToReviewComment(
      prNumber,
      userReplyCommentId,
      trimmedReply
    )

    // Store in cache only after confirming the reply is not stale
    await cache.set(cacheKey, trimmedReply, cacheTtlSeconds)
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: `${owner}/${repo}`,
      context_msg: 'Failed to post discussion reply'
    })
    throw error
  } finally {
    if (acquired && hasLockSupport) {
      await cacheAny.releaseLock!(lockKey).catch(() => {})
    }
  }

  return reply
}
