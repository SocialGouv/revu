import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicResponseProcessor } from './response-processor/processor.ts'
import { REVIEW_TOOL_NAME } from '../../shared/review-tool-schema.ts'
import { prepareLineCommentsPayload } from '../../shared/line-comments-common.ts'
import { withRetryAnthropic } from '../../../utils/retry.ts'
import { computePromptHash } from '../../../utils/prompt-prefix.ts'
import { logSystemWarning } from '../../../utils/logger.ts'
import { getRuntimeConfig } from '../../../core/utils/runtime-config.ts'

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
export async function anthropicLineCommentsSender(
  prompt: string,
  enableThinking: boolean = false
): Promise<string> {
  const runtime = await getRuntimeConfig()

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: runtime.llm.anthropic.apiKey
  })

  // Get model to enable model-specific parameter handling
  const model = runtime.llm.anthropic.model

  // Prepare shared payload parts (tools, messages, temperature, tokens, thinking)
  const prepared = prepareLineCommentsPayload(
    'anthropic',
    prompt,
    enableThinking,
    model
  )
  // Determine if extended context should be used (opt-out: enabled by default)
  const useExtendedContext = runtime.llm.anthropic.extendedContext

  const promptHash = computePromptHash(prompt, model)

  // Prepare message parameters
  const messageParams = {
    model,
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
    if (useExtendedContext) {
      message = await withRetryAnthropic(
        () => anthropic.beta.messages.create(messageParams),
        { context: { operation: 'anthropic.beta.messages.create' } }
      )
    } else {
      message = await withRetryAnthropic(
        () => anthropic.messages.create(messageParams),
        { context: { operation: 'anthropic.messages.create' } }
      )
    }

    if (runtime.discussion.promptCache.debug) {
      const usage = (message as any)?.usage ?? {}
      const metrics = {
        prompt_hash: promptHash,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens
      }
      logSystemWarning('Anthropic line-comments cache usage', {
        context_msg: JSON.stringify(metrics)
      })
    }
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
