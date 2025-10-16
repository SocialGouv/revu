import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicResponseProcessor } from './response-processor/processor.ts'
import { REVIEW_TOOL_NAME } from '../senders/shared/review-tool-schema.ts'
import { prepareLineCommentsPayload } from '../senders/shared/line-comments-common.ts'

/**
 * Line comments Anthropic sender.
 * This sender uses Anthropic's Tool Use / Function Calling capability
 * to enforce a structured JSON response with specific line-based comments.
 * Supports extended thinking when strategy includes "thinking".
 * Supports 1M token context window via Anthropic's beta API (enabled by default).
 *
 * @param prompt - The prompt to send to Anthropic
 * @param enableThinking - Optional flag to enable extended thinking capabilities
 * @returns A stringified JSON response containing structured review comments
 */
export async function lineCommentsSender(
  prompt: string,
  enableThinking: boolean = false
): Promise<string> {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Prepare shared payload parts (tools, messages, temperature, tokens, thinking)
  const prepared = prepareLineCommentsPayload('anthropic', prompt, enableThinking)
  // Determine if extended context should be used (opt-out: enabled by default)
  const useExtendedContext = process.env.ANTHROPIC_EXTENDED_CONTEXT !== 'false'

  // Prepare message parameters
  const messageParams = {
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: prepared.maxTokens,
    temperature: prepared.temperature,
    ...prepared.thinkingConfig,
    messages: prepared.messages,
    tools: prepared.tools,
    // Add beta flag only when using extended context
    ...(useExtendedContext ? { betas: ['context-1m-2025-08-07'] } : {})
  }

  // Send to Anthropic API with tool use configuration
  // Use beta API for extended context, standard API otherwise
  let message
  try {
    message = useExtendedContext
      ? await anthropic.beta.messages.create(messageParams)
      : await anthropic.messages.create(messageParams)
  } catch (error) {
    const apiType = useExtendedContext ? 'beta (extended context)' : 'standard'
    throw new Error(
      `Failed to create message using Anthropic ${apiType} API: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  // Use shared response processor with basic validation
  const processResponse = createAnthropicResponseProcessor({
    expectedToolName: REVIEW_TOOL_NAME,
    contextName: 'Inline comment'
  })
  return processResponse(message)
}
