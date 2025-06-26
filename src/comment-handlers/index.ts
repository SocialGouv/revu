import { type Context, ProbotOctokit } from 'probot'
import {
  createProxyClient,
  lineCommentsHandler
} from './line-comments-handler.ts'

/**
 * Callback type for comment handlers
 */
type CommentHandler = (
  context: Context,
  prNumber: number,
  analysis: string
) => Promise<string | void>

type ListReviewsResponse = Awaited<
  ReturnType<ProbotOctokit['rest']['pulls']['listReviews']>
>

type SingleReview = ListReviewsResponse['data'][number]

export async function upsertComment(
  context: Context,
  existingComment: SingleReview | undefined,
  formattedAnalysis: string,
  prNumber: number
) {
  const repo = context.repo()
  const proxyClient = createProxyClient()

  if (!proxyClient) {
    throw new Error(
      'PROXY_REVIEWER_TOKEN not configured, cannot post summary comment'
    )
  }

  await proxyClient.pulls.createReview({
    ...repo,
    pull_number: prNumber,
    body: formattedAnalysis,
    event: 'COMMENT'
  })
  if (existingComment) {
    return `Added follow-up review comment on PR #${prNumber}`
  } else {
    return `Created new review on PR #${prNumber}`
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
