import type { DiffFileMap } from '../core/models/diff-types.ts'
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
import {
  logReviewCompleted,
  logSystemError,
  logSystemWarning
} from '../utils/logger.ts'
import {
  constrainCommentToHunk,
  createCommentMarkerId,
  isCommentValidForDiff,
  prepareCommentContent
} from './comment-utils.ts'
import { errorCommentHandler } from './error-comment-handler.ts'
import { AnalysisSchema, SUMMARY_MARKER, type Comment } from './types.ts'

// Types for internal use
type ProcessingStats = {
  created: number
  updated: number
  deleted: number
  skipped: number
}

type PRContext = {
  commitSha: string
  diffMap: DiffFileMap
  existingComments: Array<{ id: number; body: string; path: string }>
  deletedCount: number
}

type ValidatedAnalysis = {
  summary: string
  comments: Comment[]
}

type CommentValidationResult = {
  isValid: boolean
  processableComment?: Comment
  reason?: string
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
  stats: ProcessingStats
): string =>
  `PR #${prNumber}: Created ${stats.created}, updated ${stats.updated}, deleted ${stats.deleted}, and skipped ${stats.skipped} line comments`

/**
 * Processes and validates the analysis
 */
async function processAnalysis(
  analysis: string,
  prNumber: number,
  repoName: string
): Promise<ValidatedAnalysis> {
  // Parse the JSON response first
  const rawParsedAnalysis = JSON.parse(analysis)

  // Validate the structure with Zod
  const analysisValidationResult = AnalysisSchema.safeParse(rawParsedAnalysis)

  if (!analysisValidationResult.success) {
    logSystemError(analysisValidationResult.error, {
      pr_number: prNumber,
      repository: repoName,
      context_msg: `Analysis validation failed`
    })
    throw analysisValidationResult.error
  }

  return analysisValidationResult.data as ValidatedAnalysis
}

/**
 * Handles creating the summary comment
 */
async function handleSummaryComment(
  platformContext: PlatformContext,
  prNumber: number,
  summary: string,
  repoName: string
): Promise<void> {
  const formattedSummary = createFormattedSummary(summary)

  try {
    await platformContext.client.createReview(prNumber, formattedSummary)
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: repoName,
      context_msg: `Failed to create review comment - PROXY_REVIEWER_TOKEN may not be configured. Set PROXY_REVIEWER_TOKEN environment variable with a GitHub personal access token.`
    })
    throw error
  }
}

/**
 * Fetches PR context including commit SHA, diff map, and existing comments
 */
async function fetchPRContext(
  platformContext: PlatformContext,
  prNumber: number,
  repoName: string
): Promise<PRContext> {
  let pullRequest
  let commitSha
  try {
    // Get the commit SHA for the PR head using platform client
    pullRequest = await platformContext.client.getPullRequest(prNumber)
    commitSha = pullRequest.head.sha
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: repoName,
      context_msg: `Failed to fetch pull request details`
    })
    throw error
  }

  // Fetch PR diff to identify changed lines using platform client
  const diffMap = await platformContext.client.fetchPullRequestDiffMap(prNumber)

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

  return {
    commitSha,
    diffMap,
    existingComments,
    deletedCount
  }
}

/**
 * Validates a comment for diff compatibility and attempts to constrain it if needed
 */
function validateCommentForDiff(
  comment: Comment,
  diffMap: DiffFileMap,
  prNumber: number
): CommentValidationResult {
  // First, validate that the file/line is in the diff
  if (isCommentValidForDiff(comment, diffMap)) {
    return {
      isValid: true,
      processableComment: comment
    }
  }

  // Try to constrain the comment to fit within a hunk
  const fileInfo = diffMap.get(comment.path)
  if (fileInfo && fileInfo.hunks.length > 0) {
    const constrainedComment = constrainCommentToHunk(comment, fileInfo.hunks)

    if (
      constrainedComment &&
      isCommentValidForDiff(constrainedComment, diffMap)
    ) {
      logSystemWarning(
        new Error(
          `Comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} was moved to first line of first overlapping hunk: ${constrainedComment.line}`
        ),
        {
          pr_number: prNumber,
          repository: `${comment.path}:${comment.line}`
        }
      )
      return {
        isValid: true,
        processableComment: constrainedComment
      }
    }

    return {
      isValid: false,
      reason: `Cannot constrain comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} to valid hunk`
    }
  }

  return {
    isValid: false,
    reason: `Comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} is not valid for current diff`
  }
}

/**
 * Pure function to create initial processing stats
 */
const createInitialStats = (): ProcessingStats => ({
  created: 0,
  updated: 0,
  skipped: 0,
  deleted: 0
})

/**
 * Pure function to increment a specific stat type
 */
const incrementStat = (
  stats: ProcessingStats,
  type: 'created' | 'updated' | 'skipped'
): ProcessingStats => ({
  ...stats,
  [type]: stats[type] + 1
})

/**
 * Handles the case where a comment existence check fails
 * - If the comment is not found, it creates a new comment
 * - If there is an error, it logs a warning and skips the update
 */
function handleCommentExistenceFailure(
  failedResult: {
    exists: false
    reason: 'not_found' | 'error'
    error?: unknown
  },
  existingCommentID: number
): 'created' | 'skipped' {
  if (failedResult.reason === 'not_found') {
    console.log(
      `Comment ${existingCommentID} no longer exists, creating new one`
    )
    return 'created'
  } else {
    console.warn(
      `Unable to verify comment ${existingCommentID} existence, skipping update:`,
      failedResult.error
    )
    return 'skipped'
  }
}

/**
 * Handles individual comment operation (create, update, or skip)
 */
async function handleCommentOperation(
  platformContext: PlatformContext,
  comment: Comment,
  prContext: PRContext,
  prNumber: number
): Promise<'created' | 'updated' | 'skipped'> {
  const { commitSha, existingComments } = prContext

  // Get file content and extract line content using platform client
  const fileContent = await platformContext.client.getFileContent(
    comment.path,
    commitSha
  )

  // Extract line content for hash calculation
  // For single-line comments, extract just that line
  // For multi-line comments, extract the range from start_line to line
  const lineContent = extractLineContent(
    fileContent,
    comment.line,
    comment.start_line - 10 // Adjusted to -10 for better context
  )
  const contentHash = createLineContentHash(lineContent)

  // Generate the comment content with hash and process SEARCH/REPLACE blocks
  let commentBody: string
  let updatedComment: Comment
  try {
    const result = await prepareCommentContent(
      comment,
      fileContent,
      contentHash
    )
    commentBody = result.content
    updatedComment = result.updatedComment
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      context_msg: `Failed to prepare comment content for ${comment.path}:${comment.start_line || comment.line}-${comment.line}`
    })
    return 'skipped'
  }

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
      `Skipping comment on ${updatedComment.path}:${updatedComment.start_line || updatedComment.line}-${updatedComment.line} - content unchanged`
    )
    return 'skipped'
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
      return 'updated'
    } else {
      // Cast to the correct union type since exists is false
      const failedResult = existenceResult as
        | { exists: false; reason: 'not_found' }
        | { exists: false; reason: 'error'; error: unknown }

      const existenceAction = handleCommentExistenceFailure(
        failedResult,
        existingComment.id
      )
      if (existenceAction === 'created') {
        const createCommentParams = {
          prNumber,
          commitSha,
          path: updatedComment.path,
          line: updatedComment.line,
          startLine: updatedComment.start_line,
          body: commentBody
        }
        await platformContext.client.createReviewComment(createCommentParams)
        return 'created'
      } else {
        // action === 'skipped'
        return 'skipped'
      }
    }
  } else {
    // Create new comment using platform client
    await platformContext.client.createReviewComment({
      prNumber,
      commitSha,
      path: updatedComment.path,
      line: updatedComment.line,
      startLine: updatedComment.start_line,
      body: commentBody
    })
    return 'created'
  }
}

/**
 * Processes a single line comment for a pull request.
 *
 * This function performs the following steps for each comment:
 * 1. Validates the comment to ensure it targets a valid file and line in the current diff.
 *    - If the comment is not valid, it is skipped and the statistics are updated.
 *    - If the comment can be constrained to a valid diff hunk, it is adjusted accordingly.
 * 2. Prepares the comment content, including extracting relevant file lines and generating a content hash.
 * 3. Determines whether to create a new comment, update an existing one, or skip processing based on:
 *    - The presence of an existing comment at the same location.
 *    - Whether the comment content has changed (using the content hash).
 *    - The existence and state of the existing comment (handles cases where the comment was deleted or cannot be verified).
 * 4. Performs the appropriate operation (create, update, or skip) using the platform client.
 * 5. Returns updated processing statistics reflecting the outcome of the operation.
 *
 * @param platformContext - The context object containing platform-specific clients and repository information.
 * @param comment - The line comment to process.
 * @param prContext - The pull request context, including commit SHA, diff map, and existing comments.
 * @param prNumber - The pull request number.
 * @param currentStats - The current processing statistics to be updated.
 * @returns A promise resolving to the updated processing statistics after handling the comment.
 */
const processSingleComment = async (
  platformContext: PlatformContext,
  comment: Comment,
  prContext: PRContext,
  prNumber: number,
  currentStats: ProcessingStats
): Promise<ProcessingStats> => {
  const { diffMap } = prContext

  // Validate and prepare the comment for processing
  const validationResult = validateCommentForDiff(comment, diffMap, prNumber)

  if (!validationResult.isValid) {
    console.log(
      `Skipping comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} - ${validationResult.reason || 'validation failed'}`
    )
    return incrementStat(currentStats, 'skipped')
  }

  // Process the validated comment
  const result = await handleCommentOperation(
    platformContext,
    validationResult.processableComment,
    prContext,
    prNumber
  )

  return incrementStat(currentStats, result)
}

/**
 * This function iterates over each comment in the provided list and processes them one by one
 * using the `processSingleComment` function. It maintains and updates the processing statistics
 * throughout the iteration, aggregating the results of each individual comment processing.
 *
 * @param platformContext - The context object containing platform-specific clients and repository information.
 * @param comments - An array of line comments to be processed.
 * @param prContext - The pull request context, including commit SHA, diff map, and existing comments.
 * @param prNumber - The pull request number.
 * @returns A promise resolving to the final processing statistics after all comments have been handled.
 */
async function processComments(
  platformContext: PlatformContext,
  comments: Comment[],
  prContext: PRContext,
  prNumber: number
): Promise<ProcessingStats> {
  const initialStats = createInitialStats()
  let currentStats = initialStats
  for (const comment of comments) {
    currentStats = await processSingleComment(
      platformContext,
      comment,
      prContext,
      prNumber,
      currentStats
    )
  }

  return currentStats
}

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
 *       "search_replace_blocks": [
 *         {
 *           "search": "exact code to find",
 *           "replace": "replacement code"
 *         }
 *       ]
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
    // Step 1: Process and validate analysis input
    const validatedAnalysis = await processAnalysis(
      analysis,
      prNumber,
      repoName
    )

    // Step 2: Handle summary comment
    await handleSummaryComment(
      platformContext,
      prNumber,
      validatedAnalysis.summary,
      repoName
    )

    // Step 3: Fetch PR context (commit SHA, diff map, existing comments)
    const prContext = await fetchPRContext(platformContext, prNumber, repoName)

    // Step 4: Process all comments
    const processingStats = await processComments(
      platformContext,
      validatedAnalysis.comments,
      prContext,
      prNumber
    )

    // Step 5: Log successful completion and return result
    const duration = Date.now() - startTime
    const commentStats: ProcessingStats = {
      ...processingStats,
      deleted: prContext.deletedCount
    }

    logReviewCompleted(prNumber, repoName, reviewType, duration, commentStats)
    return createSuccessMessage(prNumber, commentStats)
  } catch (error) {
    // In case of error, fall back to the error comment handler
    logSystemError(error, {
      pr_number: prNumber,
      repository: repoName,
      context_msg:
        'Error parsing or creating line comments, falling back to error comment'
    })
    return errorCommentHandler(
      platformContext,
      prNumber,
      `Error processing line comments: ${error.message || String(error)}`
    )
  }
}
