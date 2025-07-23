import * as dotenv from 'dotenv'
import { getSender } from './anthropic-senders/index.ts'
import {
  getCodingGuidelines,
  getPostProcessingConfig
} from './config-handler.ts'
import type { PlatformContext } from './core/models/platform-types.ts'
import { populateTemplate } from './populate-template.ts'
import { createPostProcessor } from './post-processors/index.ts'

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
 * 4. Optionally applies post-processing to refine the comments
 * 5. Returns the analysis response
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
  const sender = getSender(strategyName)

  // Send to Anthropic API using the selected sender
  const analysisResponse = await sender(prompt)

  // Check if post-processing is enabled and apply it
  const postProcessingConfig = await getPostProcessingConfig()
  const postProcessor = createPostProcessor(postProcessingConfig)

  if (postProcessor) {
    console.log('Post-processing enabled, refining comments...')

    try {
      // Parse the analysis response to extract comments
      const analysis = JSON.parse(analysisResponse)

      if (analysis.comments && Array.isArray(analysis.comments)) {
        // Apply post-processing to refine comments
        const refinedComments = await postProcessor.process(analysis.comments, {
          prTitle: context.prTitle,
          prBody: context.prBody,
          diff: await context.client.fetchPullRequestDiff(context.prNumber!),
          codingGuidelines: await getCodingGuidelines()
        })

        // Return the refined analysis
        const refinedAnalysis = {
          ...analysis,
          comments: refinedComments
        }

        return JSON.stringify(refinedAnalysis)
      }
    } catch (error) {
      console.warn(
        'Post-processing failed, returning original response:',
        error
      )
      // Fall back to original response if post-processing fails
    }
  }

  return analysisResponse
}
