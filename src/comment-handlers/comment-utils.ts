import {
  generateGitHubSuggestion,
  processSearchReplaceBlocks
} from '../core/services/search-replace-processor.ts'
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
  // Start with the original comment
  let updatedComment: Comment = { ...comment }

  const markerId = createCommentMarkerId(
    comment.path,
    comment.line,
    comment.start_line,
    hash
  )

  let commentBody = `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}\n\n${comment.body}`

  // Process SEARCH/REPLACE blocks if present
  if (
    comment.search_replace_blocks &&
    comment.search_replace_blocks.length > 0
  ) {
    try {
      const result = await processSearchReplaceBlocks(
        fileContent,
        comment.search_replace_blocks
      )

      if (result.success && result.replacementContent) {
        // Generate GitHub suggestion block from the replacement content
        const suggestion = generateGitHubSuggestion(result.replacementContent)
        commentBody += '\n\n' + suggestion

        // Update comment positioning with precise line ranges from SEARCH/REPLACE processing
        if (
          result.originalStartLine !== undefined &&
          result.originalEndLine !== undefined
        ) {
          // Convert from 0-based internal indexing to 1-based GitHub API indexing
          const convertedStartLine = result.originalStartLine + 1
          const convertedEndLine = result.originalEndLine + 1

          // Ensure proper ordering: start_line must be <= line (end line)
          // GitHub API requires start_line to precede or equal the end line
          const actualStartLine = Math.min(convertedStartLine, convertedEndLine)
          const actualEndLine = Math.max(convertedStartLine, convertedEndLine)

          // Validate the line range is reasonable
          if (actualStartLine <= 0 || actualEndLine <= 0) {
            logSystemWarning(
              `Invalid line range from SEARCH/REPLACE processing for ${comment.path}: start=${convertedStartLine}, end=${convertedEndLine}. Falling back to original comment positioning.`,
              {
                repository: `${comment.path}:${comment.line}`
              }
            )
          } else {
            updatedComment = {
              ...comment,
              start_line: actualStartLine,
              line: actualEndLine
            }

            // Update the marker ID to reflect the new line positioning
            const updatedMarkerId = createCommentMarkerId(
              updatedComment.path,
              updatedComment.line,
              updatedComment.start_line,
              hash
            )
            commentBody = commentBody.replace(
              `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}`,
              `${COMMENT_MARKER_PREFIX}${updatedMarkerId}${COMMENT_MARKER_SUFFIX}`
            )
          }
        }
      } else {
        logSystemWarning(
          `SEARCH/REPLACE block matching failed for ${comment.path}:${comment.line}. Errors: ${result.errors.join('; ')}. Applied blocks: ${result.appliedBlocks}. Falling back to original comment positioning.`,
          {
            repository: `${comment.path}:${comment.line}`
          }
        )
      }
    } catch (error) {
      logSystemWarning(
        `SEARCH/REPLACE processing error for ${comment.path}:${comment.line}: ${error instanceof Error ? error.message : String(error)}. Falling back to original comment positioning.`,
        {
          repository: `${comment.path}:${comment.line}`
        }
      )
    }
  }

  return {
    content: commentBody,
    updatedComment
  }
}

/**
 * Validates if a comment can be applied on the diff
 */
export function isCommentValidForDiff(
  comment: Comment,
  diffMap: Map<string, { changedLines: Set<number> }>
): boolean {
  const fileInfo = diffMap.get(comment.path)
  if (!fileInfo) {
    return false
  }

  // For multi-line comments, check if ALL lines in the range are in the diff
  if (comment.start_line !== undefined) {
    const allLinesInDiff = Array.from(
      { length: comment.line - comment.start_line + 1 },
      (_, i) => comment.start_line! + i
    ).every((line) => fileInfo.changedLines.has(line))
    return allLinesInDiff
  } else {
    // Single line comment
    return fileInfo.changedLines.has(comment.line)
  }
}
