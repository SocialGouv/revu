import { type Context } from 'probot'
import { extractMarkerIdFromComment } from './comment-utils.ts'
import {
  COMMENT_MARKER_PREFIX,
  SUMMARY_MARKER,
  isGitHubApiError,
  type Comment,
  type CommentExistenceResult
} from './types.ts'

/**
 * Finds all existing review comments on a PR that have our marker
 */
export async function findExistingComments(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all review comments on the PR
  const { data: comments } = await context.octokit.pulls.listReviewComments({
    ...repo,
    pull_number: prNumber
  })

  // Filter to comments with our marker
  return comments.filter((comment) =>
    comment.body.includes(COMMENT_MARKER_PREFIX)
  )
}

/**
 * Find the existing summary comment
 */
export async function findExistingSummaryComment(
  context: Context,
  prNumber: number
) {
  // Check for proxy username first before making any API calls
  const proxyUsername = process.env.PROXY_REVIEWER_USERNAME
  if (!proxyUsername) {
    return undefined
  }

  const repo = context.repo()

  // Get all reviews on the PR
  const { data: reviews } = await context.octokit.pulls.listReviews({
    ...repo,
    pull_number: prNumber
  })

  // Filter reviews by proxy user and containing our marker, get the most recent
  const proxyReviews = reviews
    .filter(
      (review) =>
        review.user?.login === proxyUsername &&
        review.body &&
        review.body.includes(SUMMARY_MARKER)
    )
    .sort(
      (a, b) =>
        new Date(b.submitted_at || 0).getTime() -
        new Date(a.submitted_at || 0).getTime()
    )

  return proxyReviews[0]
}

/**
 * Checks if a comment exists on GitHub robustly
 */
export async function checkCommentExistence(
  context: Context,
  commentId: number
): Promise<CommentExistenceResult> {
  try {
    await context.octokit.pulls.getReviewComment({
      ...context.repo(),
      comment_id: commentId
    })
    return { exists: true }
  } catch (error) {
    if (isGitHubApiError(error) && error.status === 404) {
      return { exists: false, reason: 'not_found' }
    }
    return { exists: false, reason: 'error', error }
  }
}

/**
 * Prepares parameters for creating a comment
 */
export function createCommentParams(
  repo: ReturnType<Context['repo']>,
  prNumber: number,
  commitSha: string,
  comment: Comment,
  commentBody: string
) {
  return {
    ...repo,
    pull_number: prNumber,
    commit_id: commitSha,
    path: comment.path,
    line: comment.line,
    body: commentBody,
    ...(comment.start_line !== undefined && {
      start_line: comment.start_line,
      side: 'RIGHT' as const,
      start_side: 'RIGHT' as const
    })
  }
}

/**
 * Cleans up obsolete comments that are no longer relevant in the current diff
 */
export async function cleanupObsoleteComments(
  context: Context,
  prNumber: number,
  diffMap: Map<string, { changedLines: Set<number> }>
): Promise<number> {
  const repo = context.repo()
  let deletedCount = 0

  // Get existing review comments
  const existingComments = await findExistingComments(context, prNumber)

  for (const comment of existingComments) {
    // Extract the marker ID from the comment
    const markerId = extractMarkerIdFromComment(comment.body)
    if (!markerId) {
      continue // Skip comments without our marker format
    }

    // Parse the marker ID to get path and line(s)
    const parts = markerId.split(':')
    if (parts.length !== 2) {
      continue // Skip malformed marker IDs
    }
    const [path, lineStr] = parts

    // Validate that we have both path and lineStr
    if (!path || !lineStr) {
      continue // Skip malformed marker IDs
    }

    // Check if it's a range (multi-line) or single line
    const isRange = lineStr.includes('-')
    let shouldDelete = false

    // First, validate line numbers before checking diff
    if (isRange) {
      // Multi-line comment: validate line numbers first
      const [startStr, endStr] = lineStr.split('-')
      const startLine = parseInt(startStr, 10)
      const endLine = parseInt(endStr, 10)

      if (isNaN(startLine) || isNaN(endLine)) {
        continue // Skip if we can't parse the line numbers
      }

      const fileInfo = diffMap.get(path)
      if (!fileInfo) {
        shouldDelete = true
      } else {
        // Check if all lines in the range are still in the diff
        const allLinesInDiff = Array.from(
          { length: endLine - startLine + 1 },
          (_, i) => startLine + i
        ).every((line) => fileInfo.changedLines.has(line))

        shouldDelete = !allLinesInDiff
      }
    } else {
      // Single line comment: validate line number first
      const line = parseInt(lineStr, 10)
      if (isNaN(line)) {
        continue // Skip if we can't parse the line number
      }

      const fileInfo = diffMap.get(path)
      if (!fileInfo) {
        shouldDelete = true
      } else {
        shouldDelete = !fileInfo.changedLines.has(line)
      }
    }

    if (shouldDelete) {
      try {
        // Delete the obsolete comment
        await context.octokit.pulls.deleteReviewComment({
          ...repo,
          comment_id: comment.id
        })
        deletedCount++
      } catch (error) {
        console.error(`Failed to delete comment ${comment.id}:`, error)
        // Continue processing other comments even if one fails
      }
    }
  }

  return deletedCount
}
