import { getAppConfig } from '../core/utils/config-loader.ts'
import { lineCommentsSender } from './line-comments-sender.ts'

/**
 * Type definition for all Anthropic senders
 */
type LLMSender = (prompt: string) => Promise<string>

/**
 * Gets the appropriate sender based on the strategy name and configuration.
 * This selects how to send and process the response to/from Anthropic API.
 *
 * @param strategyName - The name of the prompt strategy used
 * @returns The appropriate sender function
 */
export async function getSender(_strategyName?: string): Promise<LLMSender> {
  const config = await getAppConfig()
  const enableThinking = config.thinkingEnabled || false

  return (prompt: string) => lineCommentsSender(prompt, enableThinking)
}
