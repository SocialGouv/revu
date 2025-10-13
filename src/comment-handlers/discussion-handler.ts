import type { PlatformContext } from '../core/models/platform-types.ts'
import { buildReviewContext } from '../prompt-strategies/build-review-context.ts'
import { discussionSender } from '../anthropic-senders/discussion-sender.ts'
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
    replyVersion
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
    rootCommentId: parentCommentId,
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

  const prompt = buildPrompt({
    reviewCtx,
    parentCommentBody,
    userReplyBody: replyForPrompt,
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

  const MAX_CHARS_PER_FILE =
    Number(process.env.MAX_FILE_CONTENT_CHARS) || 50_000
  const MAX_TOTAL_CHARS = 200_000
  let totalChars = 0

  const filesSection = Object.entries(reviewCtx.modifiedFilesContent)
    .map(([file, content]) => {
      // Trim extremely large files and cap overall prompt size (LLM cost control)
      const remainingBudget = Math.max(0, MAX_TOTAL_CHARS - totalChars)
      const maxForThisFile = Math.min(MAX_CHARS_PER_FILE, remainingBudget)

      const body =
        content.length > maxForThisFile
          ? content.slice(0, maxForThisFile) + '\n... (truncated)'
          : content

      totalChars += body.length
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
  const cleaned = (text || '').replace(/\r/g, '')

  // Limit input length to prevent excessively large prompts
  const MAX_INPUT_LENGTH = 10000
  if (cleaned.length > MAX_INPUT_LENGTH) {
    return cleaned.slice(0, MAX_INPUT_LENGTH) + '\n... (truncated)'
  }

  return cleaned
}
