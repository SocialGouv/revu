import * as dotenv from 'dotenv'
import { getSender } from './anthropic-senders/index.ts'
import type { PlatformContext } from './core/models/platform-types.ts'
import { populateTemplate } from './populate-template.ts'

// Load environment variables
dotenv.config()

interface SendToAnthropicOptions {
  repositoryUrl: string
  branch: string
  strategyName?: string
  context: PlatformContext
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
 * @param {string} [options.strategyName] - Optional strategy name to use
 * @param {PlatformContext} options.context - Platform-agnostic context for prompt generation (required)
 * @returns {Promise<string>} The analysis response from Anthropic
 * @throws {Error} If API communication fails or response is unexpected
 * @requires ANTHROPIC_API_KEY environment variable to be set
 */
export async function sendToAnthropic({
  repositoryUrl,
  branch,
  strategyName,
  context
}: SendToAnthropicOptions) {
  // Get the populated template
  const prompt = await populateTemplate({
    repositoryUrl,
    branch,
    strategyName,
    context
  })

  // Get the appropriate sender based on the strategy
  const sender = await getSender(strategyName)

  // Send to Anthropic API using the selected sender
  return sender(prompt)
}
