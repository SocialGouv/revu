import type { PlatformContext } from '../core/models/platform-types.ts'
import { buildReviewContext } from '../prompt-strategies/build-review-context.ts'
import { discussionSender } from '../anthropic-senders/discussion-sender.ts'
import {
  buildDiscussionCacheKey,
  getComputeCache,
  simpleHash
} from '../utils/compute-cache.ts'
import { logSystemError } from '../utils/logger.ts'

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
}

/**
 * Handles a discussion reply:
 * - Rebuilds the same review context (diff, files, guidelines, issues)
 * - Generates a concise response to the user's message
 * - Posts a threaded reply to the review comment
 * - Uses a compute cache to avoid duplicate work
 */
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
    cacheTtlSeconds = 3600
  } = params

  // Build review context (shared with main review flow)
  const reviewCtx = await buildReviewContext(
    repositoryUrl,
    branch,
    platformContext
  )

  // Cache key built from stable inputs
  const cache = getComputeCache()
  const bodyHash = simpleHash(userReplyBody, 16)
  const cacheKey = buildDiscussionCacheKey({
    owner,
    repo,
    prNumber,
    rootCommentId: parentCommentId,
    lastUserReplyId: userReplyCommentId,
    lastUserReplyBodyHash: bodyHash,
    commitSha: reviewCtx.commitSha,
    model: process.env.ANTHROPIC_MODEL,
    strategyVersion: 'v1'
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
  const prompt = buildPrompt({
    reviewCtx,
    parentCommentBody,
    userReplyBody,
    history
  })

  // Generate assistant reply (concise)
  let reply: string
  try {
    reply = await discussionSender(
      prompt,
      process.env.ANTHROPIC_EXTENDED_CONTEXT === 'true'
    )
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: `${owner}/${repo}`,
      context_msg: 'Failed to generate discussion reply'
    })
    throw error
  }

  // Post threaded reply under the user's comment
  try {
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

function buildPrompt(input: {
  reviewCtx: {
    prTitle?: string
    prBody?: string
    diff: string
    modifiedFilesContent: Record<string, string>
    codingGuidelines: string
    relatedIssues: Array<{ number: number; title: string }>
    commitSha: string
  }
  parentCommentBody: string
  userReplyBody: string
  history: ThreadMessage[]
}): string {
  const { reviewCtx, parentCommentBody, userReplyBody, history } = input

  const issuesList =
    reviewCtx.relatedIssues.length > 0
      ? reviewCtx.relatedIssues
          .map((i) => `- #${i.number} ${i.title}`)
          .join('\n')
      : 'None'

  const filesSection = Object.entries(reviewCtx.modifiedFilesContent)
    .map(([file, content]) => {
      // Trim extremely large files for safety (LLM cost control)
      const MAX_CHARS = 50_000
      const body =
        content.length > MAX_CHARS
          ? content.slice(0, MAX_CHARS) + '\n... (truncated)'
          : content
      return `--- File: ${file}\n${body}`
    })
    .join('\n\n')

  const historySection =
    history.length > 0
      ? history.map((h) => `- ${h.author}: ${sanitize(h.body)}`).join('\n')
      : 'None'

  const prBodyIncluded =
    reviewCtx.prBody && reviewCtx.prBody.trim().length > 0
      ? reviewCtx.prBody
      : '(empty)'

  return [
    'You are continuing a code review discussion.',
    'Respond concisely (at most ~5 sentences).',
    'If proposing a concrete fix, include exactly one GitHub suggestion block using triple-backticks with `suggestion`.',
    'If clarification is needed, ask at most one targeted question.',
    '',
    `PR Title: ${reviewCtx.prTitle || '(no title)'}`,
    `PR Body: ${prBodyIncluded}`,
    '',
    'Coding Guidelines:',
    reviewCtx.codingGuidelines || '(none)',
    '',
    'Related Issues:',
    issuesList,
    '',
    'PR Diff (filtered to reviewable files):',
    reviewCtx.diff || '(empty)',
    '',
    'Modified Files Content (possibly truncated):',
    filesSection || '(none)',
    '',
    'Original Revu Comment (root of thread):',
    sanitize(parentCommentBody),
    '',
    'User Reply (latest message):',
    sanitize(userReplyBody),
    '',
    'Thread History (older to newer):',
    historySection
  ].join('\n')
}

function sanitize(text: string): string {
  // Basic sanitation to avoid breaking prompt formatting
  return (text || '').replace(/\r/g, '')
}
