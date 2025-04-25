import { type Context } from 'probot'
import { globalCommentHandler } from './global-comment-handler.ts'

// Marker to identify our AI review comments
const REVIEW_MARKER = '<!-- REVU-AI-REVIEW -->'

/**
 * Find existing AI review by looking for the unique marker
 */
async function findExistingReview(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all reviews on the PR
  const { data: reviews } = await context.octokit.pulls.listReviews({
    ...repo,
    pull_number: prNumber
  })

  // Find the review with our marker
  return reviews.find(
    (review) => review.body && review.body.includes(REVIEW_MARKER)
  )
}

/**
 * Handles the creation of a review with line-specific comments.
 * This expects the analysis to be a JSON string with the following structure:
 * {
 *   "summary": "Overall PR summary",
 *   "comments": [
 *     {
 *       "path": "file/path.ts",
 *       "line": 42,
 *       "body": "Comment text",
 *       "suggestion": "Optional suggested code"
 *     }
 *   ]
 * }
 */
export async function lineCommentsHandler(
  context: Context,
  prNumber: number,
  analysis: string
) {
  const repo = context.repo()

  try {
    // Parse the JSON response
    const parsedAnalysis = JSON.parse(analysis)

    // Format the summary with our marker
    const formattedSummary = `${REVIEW_MARKER}\n\n${parsedAnalysis.summary}`

    // Prepare comments for the review
    const reviewComments = parsedAnalysis.comments.map((comment) => {
      let commentBody = comment.body

      // Add suggested code if available
      if (comment.suggestion) {
        commentBody += '\n\n```suggestion\n' + comment.suggestion + '\n```'
      }

      return {
        path: comment.path,
        line: comment.line,
        body: commentBody
      }
    })

    // Check if we already have a review for this PR
    const existingReview = await findExistingReview(context, prNumber)

    if (existingReview) {
      // For now, we can't update existing review comments directly with the GitHub API
      // So we'll create a new review and mention it's an update
      await context.octokit.pulls.createReview({
        ...repo,
        pull_number: prNumber,
        event: 'COMMENT',
        body: `${REVIEW_MARKER}\n\n**Updated Review:** ${parsedAnalysis.summary}`,
        comments: reviewComments
      })

      return `Updated review with ${reviewComments.length} line comments on PR #${prNumber}`
    } else {
      // Create a new review with the summary and comments
      await context.octokit.pulls.createReview({
        ...repo,
        pull_number: prNumber,
        event: 'COMMENT',
        body: formattedSummary,
        comments: reviewComments
      })
    }

    return `Created review with ${reviewComments.length} line comments on PR #${prNumber}`
  } catch (error) {
    // In case of error, fall back to the global comment handler
    console.error(
      'Error parsing or creating line comments, falling back to global comment:',
      error
    )
    return globalCommentHandler(context, prNumber, analysis)
  }
}
