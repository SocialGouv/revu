import type { Context } from 'probot'
import type { PlatformContext } from '../../core/models/platform-types.ts'
import { getContextOctokit } from '../../github/context-utils.ts'
import { createGitHubClient } from './github-client.ts'

/**
 * Creates a platform-agnostic context from GitHub-specific Probot context
 * @param githubContext - The Probot context
 * @param prNumber - Pull request number
 * @param prTitle - Optional PR title
 * @param prBody - Optional PR body
 * @param token - Optional GitHub access token for private repositories
 * @returns Platform-agnostic context
 */
export const createPlatformContextFromGitHub = (
  githubContext: Context,
  prNumber: number,
  prTitle?: string,
  prBody?: string,
  token?: string
): PlatformContext => {
  const repo = githubContext.repo()
  const octokit = getContextOctokit(githubContext)

  return {
    repoOwner: repo.owner,
    repoName: repo.repo,
    prNumber,
    prTitle,
    prBody,
    client: createGitHubClient(octokit, repo.owner, repo.repo, token)
  }
}
