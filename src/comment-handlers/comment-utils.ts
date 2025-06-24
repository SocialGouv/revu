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
  start_line?: number
): string {
  // Create a deterministic ID based on file path and line number(s)
  const lineRange =
    start_line !== undefined ? `${start_line}-${line}` : `${line}`

  // Sanitize the path by replacing special characters with underscores
  const sanitizedPath = path.replace(/[^a-zA-Z0-9-_:.]/g, '_')

  return `${sanitizedPath}:${lineRange}`
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
    // Basic validation: should contain path:line format
    if (/^[^:]+:\d+(-\d+)?$/.test(markerId)) {
      return markerId
    }
  }

  return null
}

/**
 * Prepares the content of a comment with its marker ID
 */
export function prepareCommentContent(comment: Comment) {
  const markerId = createCommentMarkerId(
    comment.path,
    comment.line,
    comment.start_line
  )

  let commentBody = `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}\n\n${comment.body}`

  // Add suggested code if available
  if (comment.suggestion) {
    commentBody += '\n\n```suggestion\n' + comment.suggestion + '\n```'
  }

  return { markerId, commentBody }
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
