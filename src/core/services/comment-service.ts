import { extractMarkerIdFromComment } from '../../comment-handlers/comment-utils.ts'
import { COMMENT_MARKER_PREFIX } from '../../comment-handlers/types.ts'
import { logSystemError } from '../../utils/logger.ts'
import type { DiffFileMap } from '../models/diff-types.ts'
import type { PlatformClient } from '../models/platform-types.ts'
import { isLineInfoInDiff, parseLineString } from '../utils/line-parser.ts'

/**
 * Result of checking if a comment exists
 */
type CommentExistenceResult =
  | { exists: true }
  | { exists: false; reason: 'not_found' }
  | { exists: false; reason: 'error'; error: unknown }

/**
 * Finds all existing review comments on a PR that have our marker
 */
export async function findExistingComments(
  client: PlatformClient,
  prNumber: number
) {
  // Get all review comments on the PR
  const comments = await client.listReviewComments(prNumber)

  // Filter to comments with our marker
  return comments.filter((comment) =>
    comment.body.includes(COMMENT_MARKER_PREFIX)
  )
}

/**
 * Checks if a comment exists robustly
 */
export async function checkCommentExistence(
  client: PlatformClient,
  commentId: number
): Promise<CommentExistenceResult> {
  try {
    const comment = await client.getReviewComment(commentId)
    return comment ? { exists: true } : { exists: false, reason: 'not_found' }
  } catch (error) {
    // Check if it's a 404-like error (comment not found)
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 404
    ) {
      return { exists: false, reason: 'not_found' }
    }
    return { exists: false, reason: 'error', error }
  }
}

/**
 * Cleans up obsolete comments that are no longer relevant in the current diff
 */
export async function cleanupObsoleteComments(
  client: PlatformClient,
  prNumber: number,
  diffMap: DiffFileMap,
  repoName: string
): Promise<number> {
  let deletedCount = 0

  let existingComments
  try {
    // Get existing review comments
    existingComments = await findExistingComments(client, prNumber)
  } catch (error) {
    logSystemError(`Failed to fetch existing comments for cleanup: ${error}`, {
      pr_number: prNumber,
      repository: repoName
    })
    return 0 // Return 0 deleted count if we can't fetch comments
  }

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

    // Parse and validate line numbers using utility function
    const parseResult = parseLineString(lineStr)
    if (!parseResult.success) {
      continue // Skip if we can't parse the line numbers
    }

    // Check if the lines are still relevant in the current diff
    const fileInfo = diffMap.get(path)
    const shouldDelete = !isLineInfoInDiff(parseResult.lineInfo, fileInfo)

    if (shouldDelete) {
      try {
        // Delete the obsolete comment
        await client.deleteReviewComment(comment.id)
        deletedCount++
      } catch (error) {
        logSystemError(`Failed to delete comment ${comment.id}: ${error}`, {
          pr_number: prNumber,
          repository: repoName
        })
        // Continue processing other comments even if one fails
      }
    }
  }

  return deletedCount
}
