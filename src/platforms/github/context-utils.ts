import type { Context, ProbotOctokit } from 'probot'

/**
 * Safely extracts the octokit instance from a Probot context
 * @param context - The Probot context
 * @returns The octokit instance from the context
 * @throws Error if context or octokit is not available
 */
export function getContextOctokit(context: Context): ProbotOctokit {
  if (!context) {
    throw new Error('Context is required but not provided')
  }

  if (!context.octokit) {
    throw new Error('Octokit instance not available in context')
  }

  return context.octokit
}
