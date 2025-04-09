/**
 * Type definition for prompt generation strategies.
 * Each strategy is a function that implements a different approach to generating prompts for Anthropic.
 * Each strategy is responsible for both data extraction and prompt building.
 *
 * @param repositoryUrl - The URL of the GitHub repository
 * @param branch - The branch to analyze
 * @param templatePath - Optional path to a custom template file
 * @returns A promise that resolves to the generated prompt string
 */
export type PromptStrategy = (
  repositoryUrl: string,
  branch: string,
  templatePath?: string
) => Promise<string>
