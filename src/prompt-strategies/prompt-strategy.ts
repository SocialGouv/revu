/**
 * Additional context that can be passed to prompt strategies
 */
export interface PromptContext {
  /** PR title */
  prTitle?: string
  /** PR body text for extracting related issues */
  prBody?: string
  /** Repository owner for GitHub API calls */
  repoOwner?: string
  /** Repository name for GitHub API calls */
  repoName?: string
}

/**
 * Type definition for prompt generation strategies.
 * Each strategy is a function that implements a different approach to generating prompts for Anthropic.
 * Each strategy is responsible for both data extraction and prompt building.
 *
 * @param repositoryUrl - The URL of the GitHub repository
 * @param branch - The branch to analyze
 * @param templatePath - Optional path to a custom template file
 * @param token - Optional GitHub access token for private repositories
 * @param context - Optional additional context for prompt generation
 * @returns A promise that resolves to the generated prompt string
 */
export type PromptStrategy = (
  repositoryUrl: string,
  branch: string,
  templatePath?: string,
  token?: string,
  context?: PromptContext
) => Promise<string>
