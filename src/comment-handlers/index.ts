import { type Context } from 'probot'
import { globalCommentHandler } from './global-comment-handler.ts'
import { lineCommentsHandler } from './line-comments-handler.ts'
import { errorCommentHandler } from './error-comment-handler.ts'

/**
 * Callback type for comment handlers
 */
export type CommentHandler = (
  context: Context,
  prNumber: number,
  analysis: string
) => Promise<string | void>

/**
 * Gets the appropriate comment handler based on the strategy name.
 * This allows for different comment handling strategies based on the prompt strategy.
 *
 * @param strategyName - The name of the prompt strategy used
 * @returns The appropriate comment handler function
 */
export function getCommentHandler(strategyName: string): CommentHandler {
  switch (strategyName.toLowerCase()) {
    case 'line-comments':
      return lineCommentsHandler
    case 'default':
    case 'modified-files':
    default:
      return globalCommentHandler
  }
}

export { globalCommentHandler, lineCommentsHandler, errorCommentHandler }
