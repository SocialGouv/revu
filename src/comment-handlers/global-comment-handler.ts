import { type Context } from 'probot'

// Marker to identify our AI analysis comments
const COMMENT_MARKER = '<!-- REVU-AI-ANALYSIS -->'

/**
 * Find existing AI analysis comment by looking for the unique marker
 */
async function findExistingAnalysisComment(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all comments on the PR
  const { data: comments } = await context.octokit.issues.listComments({
    ...repo,
    issue_number: prNumber
  })

  // Find the comment with our marker
  return comments.find((comment) => comment.body.includes(COMMENT_MARKER))
}

/**
 * Handles the creation or update of a global comment containing the analysis.
 * This is the original behavior of the application.
 */
export async function globalCommentHandler(
  context: Context,
  prNumber: number,
  analysis: string
) {
  const repo = context.repo()

  // Format the analysis with our marker
  const formattedAnalysis = `${COMMENT_MARKER}\n\n${analysis}`

  // Check if we already have an analysis comment
  const existingComment = await findExistingAnalysisComment(context, prNumber)

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
