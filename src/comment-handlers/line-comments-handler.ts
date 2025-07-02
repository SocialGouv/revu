import type { PlatformContext } from '../core/models/platform-types.ts'
import {
  checkCommentExistence,
  cleanupObsoleteComments,
  findExistingComments
} from '../core/services/comment-service.ts'
import {
  createLineContentHash,
  extractLineContent,
  shouldReplaceComment
} from '../core/services/line-content-service.ts'
import { logReviewCompleted, logSystemError } from '../utils/logger.ts'
import {
  createCommentMarkerId,
  isCommentValidForDiff,
  prepareCommentContent
} from './comment-utils.ts'
import { errorCommentHandler } from './error-comment-handler.ts'
import { AnalysisSchema, SUMMARY_MARKER } from './types.ts'

/**
 * Pure function to extract repository information from platform context
 */
const extractRepositoryInfo = (platformContext: PlatformContext) => ({
  owner: platformContext.repoOwner,
  name: platformContext.repoName,
  fullName: `${platformContext.repoOwner}/${platformContext.repoName}`
})

/**
 * Pure function to create summary comment with marker
 */
const createFormattedSummary = (summary: string): string =>
  `${SUMMARY_MARKER}\n\n${summary}`

/**
 * Pure function to create success message
 */
const createSuccessMessage = (
  prNumber: number,
  stats: {
    created: number
    updated: number
    deleted: number
    skipped: number
  }
): string =>
  `PR #${prNumber}: Created ${stats.created}, updated ${stats.updated}, deleted ${stats.deleted}, and skipped ${stats.skipped} line comments`

/**
 * Platform-agnostic line comments handler using functional programming principles
 * Refactored from GitHub-specific to platform-agnostic implementation
 *
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
  platformContext: PlatformContext,
  prNumber: number,
  analysis: string,
  reviewType: 'on-demand' | 'automatic' = 'on-demand',
  repository?: string,
  reviewStartTime?: number
) {
  const repositoryInfo = extractRepositoryInfo(platformContext)
  const repoName = repository || repositoryInfo.fullName
  const startTime = reviewStartTime || Date.now()

  try {
    // Parse the JSON response first
    const rawParsedAnalysis = JSON.parse(analysis)

    // Validate the structure with Zod
    const analysisValidationResult = AnalysisSchema.safeParse(rawParsedAnalysis)

    if (!analysisValidationResult.success) {
      const errMsg = analysisValidationResult.error.format()
      logSystemError(`Analysis validation failed: ${errMsg}`, {
        pr_number: prNumber,
        repository: repoName
      })
      throw new Error(
        'Invalid analysis format: ' + analysisValidationResult.error.message
      )
    }

    // Use the validated and typed result
    const parsedAnalysis = analysisValidationResult.data

    // Format the summary with our marker using pure function
    const formattedSummary = createFormattedSummary(parsedAnalysis.summary)

    // Create summary comment using platform client
    try {
      await platformContext.client.createReview(prNumber, formattedSummary)
    } catch (error) {
      const errMsg = `Failed to create review comment - PROXY_REVIEWER_TOKEN may not be configured. Set PROXY_REVIEWER_TOKEN environment variable with a GitHub personal access token. Error: ${error.message}`
      logSystemError(errMsg, {
        pr_number: prNumber,
        repository: repoName
      })
      throw new Error(errMsg)
    }

    let pullRequest
    let commitSha
    try {
      // Get the commit SHA for the PR head using platform client
      pullRequest = await platformContext.client.getPullRequest(prNumber)
      commitSha = pullRequest.head.sha
    } catch (error) {
      logSystemError(`Failed to get pull request: ${error}`, {
        pr_number: prNumber,
        repository: repoName
      })
      throw error
    }

    // Fetch PR diff to identify changed lines using platform client
    const diffMap =
      await platformContext.client.fetchPullRequestDiffMap(prNumber)

    // Clean up obsolete comments first using platform client
    const deletedCount = await cleanupObsoleteComments(
      platformContext.client,
      prNumber,
      diffMap,
      repoName
    )

    // Get existing review comments AFTER cleanup using platform client
    const existingComments = await findExistingComments(
      platformContext.client,
      prNumber
    )

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

      // Get file content and extract line content using platform client
      const fileContent = await platformContext.client.getFileContent(
        comment.path,
        commitSha
      )
      const lineContent = extractLineContent(
        fileContent,
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
          platformContext.client,
          existingComment.id
        )

        if (existenceResult.exists) {
          // Update existing comment using platform client
          await platformContext.client.updateReviewComment(
            existingComment.id,
            commentBody
          )
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
            await platformContext.client.createReviewComment({
              prNumber,
              commitSha,
              path: comment.path,
              line: comment.line,
              startLine: comment.start_line,
              body: commentBody
            })
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
        // Create new comment using platform client
        await platformContext.client.createReviewComment({
          prNumber,
          commitSha,
          path: comment.path,
          line: comment.line,
          startLine: comment.start_line,
          body: commentBody
        })
        createdCount++
      }
    }

    // Log successful review completion with metrics
    const duration = Date.now() - startTime
    const commentStats = {
      created: createdCount,
      updated: updatedCount,
      deleted: deletedCount,
      skipped: skippedCount
    }
    logReviewCompleted(prNumber, repoName, reviewType, duration, commentStats)

    return createSuccessMessage(prNumber, commentStats)
  } catch (error) {
    // In case of error, fall back to the error comment handler
    logSystemError(
      `Error parsing or creating line comments, falling back to error comment: ${error}`,
      {
        pr_number: prNumber,
        repository: repoName
      }
    )
    return errorCommentHandler(
      platformContext,
      prNumber,
      `Error processing line comments: ${error.message || String(error)}`
    )
  }
}
