import { type Context } from 'probot'
import { Octokit } from '@octokit/rest'
import { fetchPrDiffFileMap } from '../extract-diff.ts'
import {
  checkCommentExistence,
  cleanupObsoleteComments,
  createCommentParams,
  findExistingComments,
  findExistingSummaryComment
} from './comment-operations.ts'
import {
  isCommentValidForDiff,
  prepareCommentContent
} from './comment-utils.ts'
import { errorCommentHandler } from './error-comment-handler.ts'
import { upsertComment } from './index.ts'
import { AnalysisSchema, SUMMARY_MARKER } from './types.ts'

/**
 * Creates a GitHub client using the proxy user's token
 */
export function createProxyClient(): Octokit | null {
  const proxyToken = process.env.PROXY_REVIEWER_TOKEN
  if (!proxyToken) {
    console.error('PROXY_REVIEWER_TOKEN not configured')
    return null
  }

  return new Octokit({
    auth: proxyToken
  })
}

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
    // Create proxy client for posting reviews as the proxy user
    const proxyClient = createProxyClient()
    if (!proxyClient) {
      console.error(
        'Failed to create proxy client, falling back to error comment'
      )
      return errorCommentHandler(
        context,
        prNumber,
        'PROXY_REVIEWER_TOKEN not configured - cannot post reviews as proxy user'
      )
    }

    // Parse the JSON response
    const rawParsedAnalysis = JSON.parse(analysis)

    // Validate the structure with Zod
    const analysisValidationResult = AnalysisSchema.safeParse(rawParsedAnalysis)

    if (!analysisValidationResult.success) {
      console.error(
        'Analysis validation failed:',
        analysisValidationResult.error.format()
      )
      throw new Error(
        'Invalid analysis format: ' + analysisValidationResult.error.message
      )
    }

    // Use the validated and typed result
    const parsedAnalysis = analysisValidationResult.data

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

    // Fetch PR diff to identify changed lines
    const diffMap = await fetchPrDiffFileMap(context, prNumber)

    // Clean up obsolete comments first
    const deletedCount = await cleanupObsoleteComments(
      context,
      prNumber,
      diffMap
    )

    // Get existing review comments AFTER cleanup
    const existingComments = await findExistingComments(context, prNumber)

    // Track created/updated comments
    let createdCount = 0
    let updatedCount = 0
    let skippedCount = 0

    // Process each comment
    for (const comment of parsedAnalysis.comments) {
      // Validate that the file/line is in the diff first
      if (!isCommentValidForDiff(comment, diffMap)) {
        console.log(
          `Skipping comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} - not valid for current diff`
        )
        skippedCount++
        continue
      }

      // Generate the comment content
      const { markerId, commentBody } = prepareCommentContent(comment)

      // Find the existing comment
      const existingComment = existingComments.find(
        (existing) =>
          existing.body.includes(`<!-- REVU-AI-COMMENT ${markerId}`) &&
          existing.path === comment.path
      )

      // Single decision: update or create with robust error handling
      if (existingComment) {
        const existenceResult = await checkCommentExistence(
          context,
          existingComment.id
        )

        if (existenceResult.exists) {
          // Update existing comment using proxy client
          await proxyClient.pulls.updateReviewComment({
            ...repo,
            comment_id: existingComment.id,
            body: commentBody
          })
          updatedCount++
        } else {
          // Cast to the correct union type since exists is false
          const failedResult = existenceResult as
            | { exists: false; reason: 'not_found' }
            | { exists: false; reason: 'error'; error: unknown }

          if (failedResult.reason === 'not_found') {
            // Comment was deleted, create a new one
            console.log(
              `Comment ${existingComment.id} no longer exists, creating new one`
            )
            const commentParams = createCommentParams(
              repo,
              prNumber,
              commitSha,
              comment,
              commentBody
            )
            await proxyClient.pulls.createReviewComment(commentParams)
            createdCount++
          } else {
            // failedResult.reason === 'error'
            console.warn(
              `Unable to verify comment ${existingComment.id} existence, skipping update:`,
              (
                failedResult as {
                  exists: false
                  reason: 'error'
                  error: unknown
                }
              ).error
            )
            skippedCount++
          }
        }
      } else {
        // Create new comment using proxy client
        const commentParams = createCommentParams(
          repo,
          prNumber,
          commitSha,
          comment,
          commentBody
        )
        await proxyClient.pulls.createReviewComment(commentParams)
        createdCount++
      }
    }

    return `PR #${prNumber}: Created ${createdCount}, updated ${updatedCount}, deleted ${deletedCount}, and skipped ${skippedCount} line comments`
  } catch (error) {
    // In case of error, fall back to the error comment handler
    console.error(
      'Error parsing or creating line comments, falling back to error comment:',
      error
    )
    return errorCommentHandler(
      context,
      prNumber,
      `Error processing line comments: ${error.message || String(error)}`
    )
  }
}
