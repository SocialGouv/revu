import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import { populateTemplate } from './populate-template.ts'

// Load environment variables
dotenv.config()

interface SendToAnthropicOptions {
  repositoryUrl: string
  branch: string
}

/**
 * Sends repository data to Anthropic's API for analysis.
 * This function:
 * 1. Initializes the Anthropic client with API key from environment
 * 2. Gets populated template with repository data
 * 3. Sends the data to Anthropic's API for analysis
 * 4. Processes and returns the analysis response
 *
 * @param {Object} options - The options for Anthropic analysis
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch to analyze
 * @returns {Promise<string>} The analysis response from Anthropic
 * @throws {Error} If API communication fails or response is unexpected
 * @requires ANTHROPIC_API_KEY environment variable to be set
 */
export async function sendToAnthropic({
  repositoryUrl,
  branch
}: SendToAnthropicOptions) {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Get the populated template
  const prompt = await populateTemplate({
    repositoryUrl,
    branch
  })

  // Send to Anthropic API
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-latest',
    max_tokens: 4096,
    temperature: 0, // Using 0 for consistent, deterministic code review feedback
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  })

  // Extract text from the content block
  if (message.content[0].type !== 'text') {
    throw new Error('Unexpected response type from Anthropic')
  }
  return message.content[0].text
}
