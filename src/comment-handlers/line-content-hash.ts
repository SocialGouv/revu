import { createHash } from 'crypto'
import { type Context } from 'probot'

/**
 * Creates a short hash of line content for comparison
 * @param content The line content to hash
 * @returns 8-character hex hash
 */
export function createLineContentHash(content: string): string {
  // Normalize content by trimming each line and removing empty lines
  const normalizedContent = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')

  // Create SHA-256 hash and take first 8 characters
  return createHash('sha256')
    .update(normalizedContent)
    .digest('hex')
    .slice(0, 8)
}

/**
 * Fetches the content of specific lines from a file
 * @param context GitHub context
 * @param filePath Path to the file
 * @param commitSha Commit SHA to fetch from
 * @param line End line number (1-indexed)
 * @param startLine Start line number (1-indexed), optional for single line
 * @returns The content of the specified lines
 */
export async function getLineContent(
  context: Context,
  filePath: string,
  commitSha: string,
  line: number,
  startLine?: number
): Promise<string> {
  try {
    const repo = context.repo()

    // Fetch file content from GitHub API
    const response = await context.octokit.repos.getContent({
      ...repo,
      path: filePath,
      ref: commitSha
    })

    // Handle the response data
    const data = response.data
    if (!('content' in data) || !data.content) {
      return ''
    }

    // Decode base64 content
    const fileContent = Buffer.from(data.content, 'base64').toString('utf-8')
    const lines = fileContent.split('\n')

    // Extract the requested lines
    if (startLine !== undefined) {
      // Multi-line comment: extract range from startLine to line (inclusive)
      const start = Math.max(0, startLine - 1) // Convert to 0-indexed
      const end = Math.min(lines.length, line) // line is already the correct end index for slice
      return lines.slice(start, end).join('\n')
    } else {
      // Single line comment
      const lineIndex = line - 1 // Convert to 0-indexed
      if (lineIndex >= 0 && lineIndex < lines.length) {
        return lines[lineIndex]
      }
    }

    return ''
  } catch (error) {
    console.warn(`Failed to fetch line content for ${filePath}:${line}:`, error)
    return ''
  }
}

/**
 * Extracts the content hash from a comment body
 * @param commentBody The comment body to extract hash from
 * @returns The hash if found, null otherwise
 */
export function extractHashFromComment(commentBody: string): string | null {
  // Look for the hash pattern in the comment marker
  const hashMatch = commentBody.match(
    /<!-- REVU-AI-COMMENT [^>]+ HASH:([a-f0-9]{8}) -->/
  )
  return hashMatch ? hashMatch[1] : null
}

/**
 * Determines if a comment should be replaced based on line content hash comparison
 * @param existingComment Existing comment or null if none exists
 * @param currentContentHash The already-computed hash of the current line content
 * @returns True if comment should be replaced, false otherwise
 */
export function shouldReplaceComment(
  existingComment: { body: string } | null,
  currentContentHash: string
): boolean {
  // Always replace if no existing comment
  if (!existingComment) {
    return true
  }

  // Extract hash from existing comment
  const existingHash = extractHashFromComment(existingComment.body)

  // If no hash in existing comment, replace (backward compatibility)
  // TODO: Remove this in one month (so on July 25th 2025)
  if (!existingHash) {
    return true
  }

  // Replace only if hashes differ
  return existingHash !== currentContentHash
}
