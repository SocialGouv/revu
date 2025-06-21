import * as dotenv from 'dotenv'
import { getSender } from './anthropic-senders/index.ts'
import { populateTemplate } from './populate-template.ts'
import type { PromptContext } from './prompt-strategies/prompt-strategy.ts'

// Load environment variables
dotenv.config()

interface SendToAnthropicOptions {
  repositoryUrl: string
  branch: string
  token?: string
  strategyName?: string
  context?: PromptContext
}

/**
 * Sends repository data to Anthropic's API for analysis.
 * This function:
 * 1. Gets populated template with repository data
 * 2. Selects the appropriate sender based on the strategy
 * 3. Sends the data to Anthropic's API for analysis with the selected sender
 * 4. Returns the analysis response
 *
 * @param {Object} options - The options for Anthropic analysis
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch to analyze
 * @param {string} [options.token] - Optional GitHub access token for private repositories
 * @param {string} [options.strategyName] - Optional strategy name to use
 * @param {PromptContext} [options.context] - Optional additional context for prompt generation
 * @returns {Promise<string>} The analysis response from Anthropic
 * @throws {Error} If API communication fails or response is unexpected
 * @requires ANTHROPIC_API_KEY environment variable to be set
 */
export async function sendToAnthropic({
  repositoryUrl,
  branch,
  token,
  strategyName,
  context
}: SendToAnthropicOptions) {
  // Get the populated template
  const prompt = await populateTemplate({
    repositoryUrl,
    branch,
    token,
    strategyName,
    context
  })

  console.log('PROMPT', prompt)
  console.log('repositoryUrl', repositoryUrl)
  console.log('branch', branch)
  console.log('strategy', strategyName || 'default')

  // Get the appropriate sender based on the strategy
  const sender = getSender(strategyName)

  // Send to Anthropic API using the selected sender
  return sender(prompt)
}
