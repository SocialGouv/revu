import {
  getStrategyByName,
  getStrategyFromConfig
} from './prompt-strategies/index.ts'
import type { PromptContext } from './prompt-strategies/prompt-strategy.ts'

interface PopulateTemplateOptions {
  repositoryUrl: string
  branch: string
  templatePath?: string
  token?: string
  strategyName?: string
  context?: PromptContext
}

/**
 * Populates a template with repository data for Anthropic analysis using the configured strategy.
 * This function:
 * 1. Gets the appropriate prompt strategy based on configuration
 * 2. Delegates to the strategy to generate the prompt
 *
 * Each strategy is responsible for:
 * - Extracting the data it needs from the repository
 * - Building the prompt based on that data
 *
 * @param {Object} options - The options for template population
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch to analyze
 * @param {string} [options.templatePath] - Optional path to the template file
 * @param {string} [options.token] - Optional GitHub access token for private repositories
 * @param {string} [options.strategyName] - Optional strategy name to use
 * @param {PromptContext} [options.context] - Optional additional context for prompt generation
 * @returns {Promise<string>} The populated template ready for Anthropic analysis
 * @throws {Error} If template reading or data extraction fails
 */
export async function populateTemplate({
  repositoryUrl,
  branch,
  templatePath,
  token,
  strategyName,
  context
}: PopulateTemplateOptions): Promise<string> {
  // Get the appropriate strategy based on provided strategy name or configuration
  const strategy = strategyName
    ? getStrategyByName(strategyName)
    : await getStrategyFromConfig()

  // Use the strategy to generate the prompt
  return strategy(repositoryUrl, branch, templatePath, token, context)
}
