import {
  REVIEW_PARAMETERS_SCHEMA,
  REVIEW_SYSTEM_INSTRUCTION,
  REVIEW_TOOL_DESCRIPTION,
  REVIEW_TOOL_NAME
} from './review-tool-schema.ts'

/**
 * Build Anthropic tool spec using the shared schema/constants.
 */
export function buildAnthropicToolSpec() {
  return {
    name: REVIEW_TOOL_NAME,
    description: REVIEW_TOOL_DESCRIPTION,
    input_schema: REVIEW_PARAMETERS_SCHEMA
  }
}

/**
 * Anthropic thinking and token configuration derived from the enableThinking flag.
 * - Returns thinkingConfig (object to spread into message params)
 * - maxTokens: higher when thinking is enabled
 * - temperature: 1 when thinking is enabled (to match Anthropic constraints), else 0
 */
export function getAnthropicThinkingConfig(enableThinking: boolean) {
  const thinkingConfig = enableThinking
    ? {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: 16000
        }
      }
    : {}

  const maxTokens = enableThinking ? 20096 : 4096
  const temperature = enableThinking ? 1 : 0

  return { thinkingConfig, maxTokens, temperature }
}

/**
 * Build OpenAI tool spec using the shared schema/constants.
 */
export function buildOpenAIToolSpec() {
  return {
    type: 'function' as const,
    function: {
      name: REVIEW_TOOL_NAME,
      description: REVIEW_TOOL_DESCRIPTION,
      parameters: REVIEW_PARAMETERS_SCHEMA
    }
  }
}

/**
 * Build OpenAI chat messages with a shared system instruction and the user prompt.
 */
export function buildOpenAIMessages(prompt: string) {
  return [
    { role: 'system' as const, content: REVIEW_SYSTEM_INSTRUCTION },
    { role: 'user' as const, content: prompt }
  ]
}

/**
 * Map thinkingEnabled to a temperature value for OpenAI.
 */
export function getOpenAITemperature(enableThinking: boolean) {
  return enableThinking ? 1 : 0
}

/**
 * Prepare common payload pieces for line-comments across providers.
 * Returns provider-specific fields while centralizing tool/message/temperature logic.
 */
export function prepareLineCommentsPayload(
  provider: 'openai',
  prompt: string,
  enableThinking: boolean
): {
  tools: ReturnType<typeof buildOpenAIToolSpec>[]
  messages: ReturnType<typeof buildOpenAIMessages>
  temperature: number
}
export function prepareLineCommentsPayload(
  provider: 'anthropic',
  prompt: string,
  enableThinking: boolean
): {
  tools: ReturnType<typeof buildAnthropicToolSpec>[]
  messages: { role: 'user'; content: string }[]
  temperature: number
  maxTokens: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thinkingConfig: any
}
export function prepareLineCommentsPayload(
  provider: 'anthropic' | 'openai',
  prompt: string,
  enableThinking: boolean
) {
  if (provider === 'anthropic') {
    const { thinkingConfig, maxTokens, temperature } =
      getAnthropicThinkingConfig(enableThinking)
    return {
      tools: [buildAnthropicToolSpec()],
      messages: [{ role: 'user' as const, content: prompt }],
      temperature,
      maxTokens,
      thinkingConfig
    }
  }

  // OpenAI
  return {
    tools: [buildOpenAIToolSpec()],
    messages: buildOpenAIMessages(prompt),
    temperature: getOpenAITemperature(enableThinking)
  }
}
