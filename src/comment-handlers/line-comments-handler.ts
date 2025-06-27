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
  createCommentMarkerId,
  isCommentValidForDiff,
  prepareCommentContent
} from './comment-utils.ts'
import { errorCommentHandler } from './error-comment-handler.ts'
import { upsertComment } from './index.ts'
import {
  createLineContentHash,
  getLineContent,
  shouldReplaceComment
} from './line-content-hash.ts'
import { AnalysisSchema, SUMMARY_MARKER } from './types.ts'

/**
 * Creates a GitHub client using the proxy user's token
 *
 * NOTE: This creates a separate Octokit instance because it uses a different
 * authentication token (proxy user's personal access token) than the GitHub App
 * token available in context.octokit. This is necessary for posting comments
 * as the proxy user rather than as the GitHub App.
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
    // Parse the JSON response first
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

    // Clean up obsolete comments first - this should happen regardless of proxy client status
    const deletedCount = await cleanupObsoleteComments(
      context,
      prNumber,
      diffMap
    )

    // Get existing review comments AFTER cleanup
    const existingComments = await findExistingComments(context, prNumber)

    // Now check if we can create proxy client for posting new/updated comments
    const proxyClient = createProxyClient()
    if (!proxyClient) {
      console.error(
        'Failed to create proxy client - cleanup completed but cannot post new comments'
      )
      // Return cleanup results even though we can't post new comments
      return `PR #${prNumber}: Deleted ${deletedCount} obsolete comments, but cannot post new comments - PROXY_REVIEWER_TOKEN not configured`
    }

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

      // Get line content and generate hash
      const lineContent = await getLineContent(
        context,
        comment.path,
        commitSha,
        comment.line,
        comment.start_line
      )
      const contentHash = createLineContentHash(lineContent)

      // Generate the comment content with hash
      const commentBody = prepareCommentContent(comment, contentHash)

      // Find the existing comment (look for comments with same path and line range)
      const baseMarkerId = createCommentMarkerId(
        comment.path,
        comment.line,
        comment.start_line
      )

      const existingComment = existingComments.find(
        (existing) =>
          existing.body.includes(`<!-- REVU-AI-COMMENT ${baseMarkerId}`) &&
          existing.path === comment.path
      )

      // Check if we should replace the comment based on content hash
      const shouldReplace = shouldReplaceComment(existingComment, contentHash)

      if (!shouldReplace && existingComment) {
        console.log(
          `Skipping comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} - content unchanged`
        )
        skippedCount++
        continue
      }

      // Single decision: update or create with robust error handling
      if (existingComment && shouldReplace) {
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
