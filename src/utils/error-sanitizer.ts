/**
 * Utility functions for sanitizing error messages to prevent token leakage
 */

/**
 * Sanitizes git commands and URLs in error messages to remove sensitive tokens
 * @param errorMessage - The original error message that may contain sensitive data
 * @returns Sanitized error message with tokens replaced by [REDACTED]
 */
export function sanitizeErrorMessage(errorMessage: string): string {
  if (!errorMessage) return errorMessage

  // Pattern to match GitHub access tokens in URLs
  // Matches: https://x-access-token:TOKEN@github.com/...
  const tokenUrlPattern = /https:\/\/x-access-token:([^@]+)@/g

  // Pattern to match any GitHub token (ghs_, ghp_, etc.)
  // GitHub tokens are typically 36+ characters but we'll be more flexible for test tokens
  const tokenPattern = /gh[sprouv]_\W{6,255}/g

  return (
    errorMessage
      // Replace token URLs with sanitized version - preserve the x-access-token part
      .replace(tokenUrlPattern, 'https://x-access-token:[REDACTED]@')
      // Replace any standalone GitHub tokens
      .replace(tokenPattern, '[REDACTED_TOKEN]')
  )
}

/**
 * Sanitizes git command strings to remove tokens before logging
 * @param command - The git command that may contain sensitive tokens
 * @returns Sanitized command with tokens replaced
 */
export function sanitizeGitCommand(command: string): string {
  if (!command) return command

  // Replace tokens in git clone commands
  const tokenUrlPattern = /https:\/\/x-access-token:[^@]+@/g
  const genericTokenPattern = /https:\/\/[^:]+:[^@]+@/g

  return command
    .replace(tokenUrlPattern, 'https://x-access-token:[REDACTED]@')
    .replace(genericTokenPattern, 'https://[REDACTED]@')
}

/**
 * Creates a sanitized error object from an original error
 * @param error - The original error object
 * @returns New error object with sanitized message and stack
 */
export function createSanitizedError(error: Error): Error {
  const sanitizedError = new Error(sanitizeErrorMessage(error.message))
  sanitizedError.name = error.name

  if (error.stack) {
    sanitizedError.stack = sanitizeErrorMessage(error.stack)
  }

  return sanitizedError
}
