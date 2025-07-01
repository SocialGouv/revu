import { Octokit } from '@octokit/rest'
import type { Context } from 'probot'
import type { PlatformContext } from '../core/models/platform-types.ts'
import { fetchPrDiffFileMap } from '../extract-diff.ts'
import { logReviewCompleted, logSystemError } from '../utils/logger.ts'
import {
  checkCommentExistence,
  cleanupObsoleteComments,
  findExistingComments
} from './comment-operations.ts'
import {
  createCommentMarkerId,
  isCommentValidForDiff,
  prepareCommentContent
} from './comment-utils.ts'
import { errorCommentHandler } from './error-comment-handler.ts'
import {
  createLineContentHash,
  getLineContent,
  shouldReplaceComment
} from './line-content-hash.ts'
import { AnalysisSchema, SUMMARY_MARKER } from './types.ts'

/**
 * Creates a proxy client for GitHub operations using the proxy reviewer token
 */
export function createProxyClient(): Octokit | null {
  const token = process.env.PROXY_REVIEWER_TOKEN
  if (!token) {
    return null
  }
  return new Octokit({ auth: token })
}

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
  const repoParams = { owner: repositoryInfo.owner, repo: repositoryInfo.name }
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

    // Get the commit SHA for the PR head using platform client
    const pullRequest = await platformContext.client.getPullRequest(prNumber)
    const commitSha = pullRequest.head.sha

    // Create a complete mock context with all required Octokit methods
    const proxyClient = createProxyClient()
    if (!proxyClient) {
      throw new Error(
        'PROXY_REVIEWER_TOKEN not configured - required for GitHub operations'
      )
    }

    const mockContext = {
      repo: () => repoParams,
      octokit: {
        request: proxyClient.request.bind(proxyClient),
        repos: {
          getContent: proxyClient.repos.getContent.bind(proxyClient)
        },
        pulls: {
          get: async () => ({ data: pullRequest }),
          listReviewComments: async (params) => {
            const comments = await platformContext.client.listReviewComments(
              params.pull_number
            )
            return { data: comments }
          },
          getReviewComment: async (params) => {
            const comment = await platformContext.client.getReviewComment(
              params.comment_id
            )
            return { data: comment }
          },
          deleteReviewComment:
            proxyClient.pulls.deleteReviewComment.bind(proxyClient),
          listReviews: proxyClient.pulls.listReviews.bind(proxyClient)
        }
      }
    } as unknown as Context

    // Fetch PR diff to identify changed lines
    const diffMap = await fetchPrDiffFileMap(mockContext, prNumber)

    // Clean up obsolete comments first
    const deletedCount = await cleanupObsoleteComments(
      mockContext,
      prNumber,
      diffMap
    )

    // Get existing review comments AFTER cleanup
    const existingComments = await findExistingComments(mockContext, prNumber)

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

      // Get line content and generate hash using mock context
      const lineContent = await getLineContent(
        mockContext,
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
          mockContext,
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
