import { guidedExecutionSender } from './guided-execution-sender.ts'
import { lineCommentsSender } from './line-comments-sender.ts'
import { reviewPlanningSender } from './planning-sender.ts'

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
    case 'review-planning':
      return reviewPlanningSender
    case 'guided-execution':
      return guidedExecutionSender
    case 'line-comments':
      return lineCommentsSender
    case 'thinking-line-comments':
      return (prompt: string) => lineCommentsSender(prompt, true)
    default:
      return lineCommentsSender
  }
}
