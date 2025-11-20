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
  const cacheKey = buildDiscussionCacheKey({
    owner,
    repo,
    prNumber,
    rootCommentId: rootCommentId ?? parentCommentId,
    lastUserReplyId: userReplyCommentId,
    lastUserReplyBodyHash: bodyHash,
    commitSha: reviewCtx.commitSha,
    model: process.env.ANTHROPIC_MODEL,
    strategyVersion: 'v1',
    lastUserReplyLen: replyLen,
    replyVersion
  })

  // Try cache
  const cachedBody = await cache.get<string>(cacheKey)
  if (cachedBody) {
    // Before posting cached reply, ensure the user reply has not changed
    try {
      const currentAfter = (await platformContext.client.getReviewComment(
        userReplyCommentId
      )) as ReviewCommentSnapshot
      if (
        currentAfter?.body !== userReplyBody ||
        (replyVersion && currentAfter?.updated_at !== replyVersion)
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

      await platformContext.client.replyToReviewComment(
        prNumber,
        userReplyCommentId,
        cachedBody
      )
    } catch (error) {
      logSystemError(error, {
        pr_number: prNumber,
        repository: `${owner}/${repo}`,
        context_msg:
          'Failed to post cached discussion reply or validate stale state'
      })
      throw error
    }

    return cachedBody
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
    if (
      currentAfter?.body !== userReplyBody ||
      (replyVersion && currentAfter?.updated_at !== replyVersion)
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

    await platformContext.client.replyToReviewComment(
      prNumber,
      userReplyCommentId,
      reply
    )

    // Store in cache only after confirming the reply is not stale
    await cache.set(cacheKey, reply, cacheTtlSeconds)
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: `${owner}/${repo}`,
      context_msg: 'Failed to post discussion reply'
    })
    throw error
  }

  return reply
}
