import { type Context } from 'probot'
import { z } from 'zod'
import {
  globalCommentHandler,
  upsertComment
} from './global-comment-handler.ts'

// Marker for the global summary comment
const SUMMARY_MARKER = '<!-- REVU-AI-SUMMARY -->'

// Marker pattern for individual comments
// Each comment gets a unique ID based on file path and line number
const COMMENT_MARKER_PREFIX = '<!-- REVU-AI-COMMENT '
const COMMENT_MARKER_SUFFIX = ' -->'

/**
 * Creates a unique marker ID for a specific comment
 */
function createCommentMarkerId(path: string, line: number): string {
  // Create a deterministic ID based on file path and line number
  return `${path}:${line}`.replace(/[^a-zA-Z0-9-_:.]/g, '_')
}

/**
 * Finds all existing review comments on a PR that have our marker
 */
async function findExistingComments(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all review comments on the PR
  const { data: comments } = await context.octokit.pulls.listReviewComments({
    ...repo,
    pull_number: prNumber
  })

  // Filter to comments with our marker
  return comments.filter((comment) =>
    comment.body.includes(COMMENT_MARKER_PREFIX)
  )
}

/**
 * Find the existing summary comment
 */
async function findExistingSummaryComment(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all comments on the PR
  const { data: comments } = await context.octokit.issues.listComments({
    ...repo,
    issue_number: prNumber
  })

  // Find the comment with our marker
  return comments.find((comment) => comment.body.includes(SUMMARY_MARKER))
}

// Schémas de validation pour garantir le bon format de la réponse
const CommentSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  body: z.string(),
  suggestion: z.string().optional()
})

const AnalysisSchema = z.object({
  summary: z.string(),
  comments: z.array(CommentSchema)
})

/**
 * Handles the creation of individual review comments on specific lines.
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
    const rawParsedAnalysis = JSON.parse(analysis)

    // Valider la structure avec Zod
    const validationResult = AnalysisSchema.safeParse(rawParsedAnalysis)

    if (!validationResult.success) {
      console.error(
        "Validation de l'analyse échouée :",
        validationResult.error.format()
      )
      throw new Error(
        "Format d'analyse invalide : " + validationResult.error.message
      )
    }

    // Utiliser le résultat validé et typé
    const parsedAnalysis = validationResult.data

    // Format the summary with our marker
    const formattedSummary = `${SUMMARY_MARKER}\n\n${parsedAnalysis.summary}`

    // Handle the summary comment (global PR comment)
    const existingSummary = await findExistingSummaryComment(context, prNumber)

    await upsertComment(context, existingSummary, formattedSummary, prNumber)

    // Get the commit SHA for the PR head
    const { data: pullRequest } = await context.octokit.pulls.get({
      ...repo,
      pull_number: prNumber
    })
    const commitSha = pullRequest.head.sha

    // Get existing review comments
    const existingComments = await findExistingComments(context, prNumber)

    // Track created/updated comments
    let createdCount = 0
    let updatedCount = 0

    // Process each comment
    for (const comment of parsedAnalysis.comments) {
      // Generate marker ID for this comment
      const markerId = createCommentMarkerId(comment.path, comment.line)

      // Format the comment body with marker
      let commentBody = `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}\n\n${comment.body}`

      // Add suggested code if available
      if (comment.suggestion) {
        commentBody += '\n\n```suggestion\n' + comment.suggestion + '\n```'
      }

      // Check if this comment already exists
      const existingComment = existingComments.find(
        (existing) =>
          existing.body.includes(`${COMMENT_MARKER_PREFIX}${markerId}`) &&
          existing.path === comment.path
      )

      if (existingComment) {
        // Update existing comment
        await context.octokit.pulls.updateReviewComment({
          ...repo,
          comment_id: existingComment.id,
          body: commentBody
        })
        updatedCount++
      } else {
        // Create new comment
        await context.octokit.pulls.createReviewComment({
          ...repo,
          pull_number: prNumber,
          commit_id: commitSha,
          path: comment.path,
          line: comment.line,
          body: commentBody
        })
        createdCount++
      }
    }

    return `PR #${prNumber}: Created ${createdCount} and updated ${updatedCount} line comments`
  } catch (error) {
    // In case of error, fall back to the global comment handler
    console.error(
      'Error parsing or creating line comments, falling back to global comment:',
      error
    )
    return globalCommentHandler(context, prNumber, analysis)
  }
}
