import Anthropic from '@anthropic-ai/sdk'

/**
 * Discussion Anthropic sender.
 * Produces a single, concise assistant reply (plain markdown/text).
 *
 * @param prompt - The prompt to send to Anthropic
 * @param enableThinking - Optional flag to enable extended thinking capabilities
 * @returns Assistant reply text
 */
export async function discussionSender(
  prompt: string,
  enableThinking: boolean = false
): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  const thinkingConfig = enableThinking
    ? {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: 4000
        }
      }
    : {}

  const maxTokens = enableThinking ? 4096 : 1024
  const useExtendedContext = process.env.ANTHROPIC_EXTENDED_CONTEXT !== 'false'

  const messageParams = {
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    max_tokens: maxTokens,
    temperature: enableThinking ? 0.2 : 0,
    ...thinkingConfig,
    messages: [
      {
        role: 'user' as const,
        content: prompt
      }
    ],
    ...(useExtendedContext ? { betas: ['context-1m-2025-08-07'] } : {})
  }

  try {
    const message = useExtendedContext
      ? await anthropic.beta.messages.create(messageParams)
      : await anthropic.messages.create(messageParams)

    // Extract first text block
    const content = (message as any)?.content
    if (Array.isArray(content)) {
      const textBlock = content.find((c: any) => c?.type === 'text')
      if (textBlock?.text && typeof textBlock.text === 'string') {
        return textBlock.text
      }
    }
    // Fallback to stringifying if unexpected shape
    return typeof (message as any)?.content === 'string'
      ? ((message as any).content as string)
      : JSON.stringify(message)
  } catch (error) {
    const apiType = useExtendedContext ? 'beta (extended context)' : 'standard'
    throw new Error(
      `Failed to create message using Anthropic ${apiType} API: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
