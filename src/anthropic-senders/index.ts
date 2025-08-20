import { lineCommentsSender } from './line-comments-sender.ts'

/**
 * Type definition for all Anthropic senders
 */
type LLMSender = (prompt: string) => Promise<string>

/**
 * Gets the appropriate sender based on the strategy name.
 * This selects how to send and process the response to/from Anthropic API.
 *
 * @param strategyName - The name of the prompt strategy used
 * @returns The appropriate sender function
 */
export function getSender(strategyName?: string): LLMSender {
  switch (strategyName?.toLowerCase()) {
    case 'line-comments':
      return lineCommentsSender
    case 'thinking-line-comments':
      return (prompt: string) => lineCommentsSender(prompt, true)
    default:
      return lineCommentsSender
  }
}
