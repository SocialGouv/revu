import type { DiffHunk } from '../core/models/diff-types.ts'
import {
  generateGitHubSuggestion,
  processSearchReplaceBlocks
} from '../core/services/search-replace-processor.ts'
import {
  containsEquivalentSuggestionBlock,
  dedupeSuggestionBlocks
} from '../utils/markdown.ts'
import { logSystemWarning } from '../utils/logger.ts'
import {
  COMMENT_MARKER_PREFIX,
  COMMENT_MARKER_SUFFIX,
  type Comment
} from './types.ts'

/**
 * Creates a unique marker ID for a specific comment
 */
export function createCommentMarkerId(
  path: string,
  line: number,
  start_line?: number,
  hash?: string
): string {
  // Create a deterministic ID based on file path and line number(s)
  const lineRange =
    start_line !== undefined ? `${start_line}-${line}` : `${line}`

  // Sanitize the path by replacing special characters with underscores
  const sanitizedPath = path.replace(/[^a-zA-Z0-9-_:.]/g, '_')

  const baseId = `${sanitizedPath}:${lineRange}`
  return hash ? `${baseId} HASH:${hash}` : baseId
}

/**
 * Extracts the marker ID from a comment body
 */
export function extractMarkerIdFromComment(commentBody: string): string | null {
  const escapedPrefix = COMMENT_MARKER_PREFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  )
  const escapedSuffix = COMMENT_MARKER_SUFFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  )

  const match = commentBody.match(
    new RegExp(`${escapedPrefix}(.+?)${escapedSuffix}`)
  )

  // Validate the extracted marker ID format
  if (match && match[1]) {
    const markerId = match[1]
    // Basic validation: should contain path:line format, optionally with hash
    if (/^[^:]+:\d+(-\d+)?( HASH:[a-f0-9]{8})?$/.test(markerId)) {
      return markerId
    }
  }

  return null
}

/**
 * Logs SEARCH/REPLACE processing errors with consistent formatting
 */
function logSearchReplaceError(
  comment: Comment,
  error: unknown,
  context?: string
): void {
  const contextMsg =
    context ||
    `SEARCH/REPLACE processing error for ${comment.path}:${comment.line}. Falling back to original comment positioning.`

  logSystemWarning(error, {
    repository: `${comment.path}:${comment.line}`,
    context_msg: contextMsg
  })
}

/**
 * Logs SEARCH/REPLACE matching failure with detailed error information
 */
function logSearchReplaceMatchingError(
  comment: Comment,
  errors: string[],
  appliedBlocks: number
): void {
  const errorMessage = errors.length > 0 ? errors.join('; ') : 'Unknown error'

  logSystemWarning(
    new Error(
      `SEARCH/REPLACE block matching failed for ${comment.path}:${comment.line}. Errors: ${errorMessage}. Applied blocks: ${appliedBlocks}. Falling back to original comment positioning.`
    ),
    {
      repository: `${comment.path}:${comment.line}`
    }
  )
}

/**
 * Logs line positioning validation errors
 */
function logLinePositioningError(
  comment: Comment,
  convertedStartLine: number,
  convertedEndLine: number
): void {
  logSystemWarning(
    new Error(
      `Invalid line range from SEARCH/REPLACE processing for ${comment.path}: start=${convertedStartLine}, end=${convertedEndLine}. Falling back to original comment positioning.`
    ),
    {
      repository: `${comment.path}:${comment.line}`
    }
  )
}

/**
 * Updates comment line positioning based on SEARCH/REPLACE results
 * Returns updated comment and marker ID, or null if positioning is invalid
 */
function updateCommentLinePositioning(
  comment: Comment,
  originalStartLine: number,
  originalEndLine: number,
  hash?: string
): { updatedComment: Comment; updatedMarkerId: string } | null {
  // Convert from 0-based internal indexing to 1-based GitHub API indexing
  const convertedStartLine = originalStartLine + 1
  const convertedEndLine = originalEndLine + 1

  // Ensure proper ordering: start_line must be <= line (end line)
  // GitHub API requires start_line to precede or equal the end line
  const actualStartLine = Math.min(convertedStartLine, convertedEndLine)
  const actualEndLine = Math.max(convertedStartLine, convertedEndLine)

  // Validate the line range is reasonable
  if (actualStartLine <= 0 || actualEndLine <= 0) {
    logLinePositioningError(comment, convertedStartLine, convertedEndLine)
    return null
  }

  const updatedComment: Comment = {
    ...comment,
    start_line: actualStartLine,
    line: actualEndLine
  }

  const updatedMarkerId = createCommentMarkerId(
    updatedComment.path,
    updatedComment.line,
    updatedComment.start_line,
    hash
  )

  return { updatedComment, updatedMarkerId }
}

/**
 * Processes SEARCH/REPLACE blocks for a comment and updates content accordingly
 * Returns the updated comment body and comment object
 */
async function processSearchReplaceForComment(
  comment: Comment,
  fileContent: string,
  commentBody: string,
  markerId: string,
  hash?: string
): Promise<{
  updatedCommentBody: string
  updatedComment: Comment
}> {
  if (
    !comment.search_replace_blocks ||
    comment.search_replace_blocks.length === 0
  ) {
    return {
      updatedCommentBody: commentBody,
      updatedComment: comment
    }
  }

  try {
    const result = await processSearchReplaceBlocks(
      fileContent,
      comment.search_replace_blocks
    )

    if (result.success && result.replacementContent) {
      // Generate GitHub suggestion block from the replacement content
      const suggestion = generateGitHubSuggestion(result.replacementContent)
      // Avoid duplicating a suggestion if the model already included an equivalent block.
      let updatedCommentBody = containsEquivalentSuggestionBlock(
        commentBody,
        suggestion
      )
        ? commentBody
        : commentBody + '\n\n' + suggestion

      // Update comment positioning with precise line ranges from SEARCH/REPLACE processing
      if (
        result.originalStartLine !== undefined &&
        result.originalEndLine !== undefined
      ) {
        const positioningResult = updateCommentLinePositioning(
          comment,
          result.originalStartLine,
          result.originalEndLine,
          hash
        )

        if (positioningResult) {
          // Update the marker ID to reflect the new line positioning
          updatedCommentBody = updatedCommentBody.replace(
            `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}`,
            `${COMMENT_MARKER_PREFIX}${positioningResult.updatedMarkerId}${COMMENT_MARKER_SUFFIX}`
          )

          return {
            updatedCommentBody,
            updatedComment: positioningResult.updatedComment
          }
        }
      }

      // If positioning update failed, return with suggestion but original comment
      return {
        updatedCommentBody,
        updatedComment: comment
      }
    } else {
      logSearchReplaceMatchingError(
        comment,
        result.errors,
        result.appliedBlocks
      )
      return {
        updatedCommentBody: commentBody,
        updatedComment: comment
      }
    }
  } catch (error) {
    logSearchReplaceError(comment, error)
    return {
      updatedCommentBody: commentBody,
      updatedComment: comment
    }
  }
}

/**
 * Prepares the content of a comment with its marker ID and processes SEARCH/REPLACE blocks
 * Returns both the comment content and an updated comment with precise line positioning
 */
export async function prepareCommentContent(
  comment: Comment,
  fileContent: string,
  hash?: string
): Promise<{
  content: string
  updatedComment: Comment
}> {
  const markerId = createCommentMarkerId(
    comment.path,
    comment.line,
    comment.start_line,
    hash
  )

  const initialCommentBody = `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}\n\n${comment.body}`

  const result = await processSearchReplaceForComment(
    comment,
    fileContent,
    initialCommentBody,
    markerId,
    hash
  )

  // Final hardening: dedupe repeated suggestion fences inside one comment body.
  // This protects against LLM self-duplication and model+auto-suggestion duplication.
  const deduped = dedupeSuggestionBlocks(result.updatedCommentBody)

  return {
    content: deduped.markdown,
    updatedComment: result.updatedComment
  }
}

/**
 * Finds the hunk that contains a specific line number
 */
export function findHunkForLine(
  hunks: DiffHunk[],
  lineNumber: number
): DiffHunk | null {
  return (
    hunks.find(
      (hunk) => lineNumber >= hunk.startLine && lineNumber <= hunk.endLine
    ) || null
  )
}

/**
 * Checks if two line numbers are in the same hunk
 */
export function areInSameHunk(
  hunks: DiffHunk[],
  startLine: number,
  endLine: number
): boolean {
  const startHunk = findHunkForLine(hunks, startLine)
  const endHunk = findHunkForLine(hunks, endLine)

  return startHunk !== null && endHunk !== null && startHunk === endHunk
}

/**
 * Constrains a comment's line range to fit within a single hunk
 * Returns the adjusted comment or null if no valid range can be found
 */
export function constrainCommentToHunk(
  comment: Comment,
  hunks: DiffHunk[]
): Comment | null {
  if (!comment.start_line) {
    // Single line comment - just check if it's in any hunk
    const hunk = findHunkForLine(hunks, comment.line)
    return hunk ? comment : null
  }

  // Multi-line comment - check if it fits in a single hunk
  if (areInSameHunk(hunks, comment.start_line, comment.line)) {
    return comment
  }

  // Comment spans multiple hunks - find the first hunk that overlaps with the comment range
  const firstOverlappingHunk = hunks.find(
    (hunk) =>
      // Hunk overlaps if: hunk.startLine <= comment.line && hunk.endLine >= comment.start_line
      hunk.startLine <= comment.line && hunk.endLine >= comment.start_line
  )

  if (firstOverlappingHunk) {
    return {
      ...comment,
      line: firstOverlappingHunk.startLine,
      start_line: undefined // Make it a single-line comment
    }
  }

  return null
}

/**
 * Validates if a comment can be applied on the diff
 */
export function isCommentValidForDiff(
  comment: Comment,
  diffMap: Map<string, { changedLines: Set<number>; hunks: DiffHunk[] }>
): boolean {
  const fileInfo = diffMap.get(comment.path)
  if (!fileInfo) {
    return false
  }

  // For multi-line comments, check if ALL lines in the range are in the diff
  // AND that they are in the same hunk
  if (comment.start_line !== undefined) {
    const allLinesInDiff = Array.from(
      { length: comment.line - comment.start_line + 1 },
      (_, i) => comment.start_line + i
    ).every((line) => fileInfo.changedLines.has(line))

    const inSameHunk = areInSameHunk(
      fileInfo.hunks,
      comment.start_line,
      comment.line
    )

    return allLinesInDiff && inSameHunk
  } else {
    // Single line comment - check if it's in the diff and in a hunk
    const inDiff = fileInfo.changedLines.has(comment.line)
    const inHunk = findHunkForLine(fileInfo.hunks, comment.line) !== null

    return inDiff && inHunk
  }
}
