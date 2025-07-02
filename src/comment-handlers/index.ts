import type { PlatformContext } from '../core/models/platform-types.ts'
import { lineCommentsHandler } from './line-comments-handler.ts'

/**
 * Callback type for comment handlers
 */
type CommentHandler = (
  platformContext: PlatformContext,
  prNumber: number,
  analysis: string,
  reviewType?: 'on-demand' | 'automatic',
  repository?: string,
  reviewStartTime?: number
) => Promise<string | void>

/**
 * Gets the appropriate comment handler based on the strategy name.
 * This allows for different comment handling strategies based on the prompt strategy.
 *
 * @param strategyName - The name of the prompt strategy used
 * @returns The appropriate comment handler function
 */
export function getCommentHandler(_strategyName: string): CommentHandler {
  // switch (strategyName.toLowerCase()) {
  //   case 'line-comments':
  //     return lineCommentsHandler
  //   case 'default':
  //   default:
  //     return globalCommentHandler
  // }

  return lineCommentsHandler
}
