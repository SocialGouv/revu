import { type Context, ProbotOctokit } from 'probot'
import { lineCommentsHandler } from './line-comments-handler.ts'

/**
 * Callback type for comment handlers
 */
type CommentHandler = (
  context: Context,
  prNumber: number,
  analysis: string
) => Promise<string | void>

type ListCommentsResponse = Awaited<
  ReturnType<ProbotOctokit['rest']['issues']['listComments']>
>

type SingleComment = ListCommentsResponse['data'][number]

export async function upsertComment(
  context: Context,
  existingComment: SingleComment,
  formattedAnalysis: string,
  prNumber: number
) {
  const repo = context.repo()

  if (existingComment) {
    // Update the existing comment
    await context.octokit.issues.updateComment({
      ...repo,
      comment_id: existingComment.id,
      body: formattedAnalysis
    })
    return `Updated existing analysis comment on PR #${prNumber}`
  } else {
    // Post a new comment
    await context.octokit.issues.createComment({
      ...repo,
      issue_number: prNumber,
      body: formattedAnalysis
    })
    return `Created new analysis comment on PR #${prNumber}`
  }
}

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
