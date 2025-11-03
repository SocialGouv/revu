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

  // Early stale-guard: if the reply has changed since webhook reception, skip
  try {
    const currentBefore =
      await platformContext.client.getReviewComment(userReplyCommentId)
    if (currentBefore?.body && currentBefore.body !== userReplyBody) {
      logSystemWarning(
        'Stale reply detected before processing - skipping discussion generation',
        {
          pr_number: prNumber,
          repository: `${owner}/${repo}`,
          context_msg: 'User edited reply before processing started'
        }
      )
      return 'stale_skipped'
    }
  } catch {
    // Ignore guard failure and proceed
  }

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
  const cached = await cache.get<string>(cacheKey)
  if (cached) {
    // Post cached reply
    await platformContext.client.replyToReviewComment(
      prNumber,
      userReplyCommentId,
      cached
    )
    return cached
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
    const current =
      await platformContext.client.getReviewComment(userReplyCommentId)
    if (current?.body && current.body !== userReplyBody) {
      logSystemWarning(
        'Stale reply detected before posting - skipping discussion reply',
        {
          pr_number: prNumber,
          repository: `${owner}/${repo}`,
          context_msg:
            'User edited reply during processing; not posting potentially stale response'
        }
      )
      return 'stale_skipped'
    }

    await platformContext.client.replyToReviewComment(
      prNumber,
      userReplyCommentId,
      reply
    )
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: `${owner}/${repo}`,
      context_msg: 'Failed to post discussion reply'
    })
    throw error
  }

  // Store in cache
  await cache.set(cacheKey, reply, cacheTtlSeconds)

  return reply
}
