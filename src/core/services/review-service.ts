import { errorCommentHandler } from '../../comment-handlers/error-comment-handler.ts'
import { lineCommentsHandler } from '../../comment-handlers/line-comments-handler.ts'
import { getValidationConfig } from '../../config-handler.ts'
import { sendToLLM } from '../../send-to-llm.ts'
import {
  logReviewFailed,
  logReviewStarted,
  logSystemError
} from '../../utils/logger.ts'
import type { PlatformContext } from '../models/platform-types.ts'
import { getAppConfig } from '../utils/config-loader.ts'
import { formatValidationIssues, validatePR } from './pr-validation-service.ts'

// Types
interface ReviewOptions {
  submitComments: boolean
  reviewType?: 'on-demand' | 'automatic'
  repoPath?: string
  repository?: string
  strategy?: string
}

export interface ValidationIssue {
  reason: string
  suggestion: string
}

export interface ValidationResult {
  isValid: boolean
  issues: Array<ValidationIssue>
  metrics: {
    filesChanged: number
    reviewableFilesChanged: number
    diffSize: number
    largestFileSize?: number
    additionDeletionRatio?: number
    documentationOnlyFiles: number
  }
}

export interface ReviewResult {
  success: boolean
  analysis?: string
  validationResult?: ValidationResult
  error?: string
  message?: string
}
interface ReviewContext {
  repositoryUrl: string
  prNumber: number
  branch: string
  platformContext: PlatformContext
  options: ReviewOptions
}

// Strategy resolution with priority: options.strategy > config.json > default
const chooseStrategy = async (options: ReviewOptions): Promise<string> => {
  if (options.strategy) {
    return options.strategy
  }

  const config = await getAppConfig()
  return config.promptStrategy
}

const createValidationMessage = (
  validationResult: ReviewResult['validationResult']
): string => {
  if (!validationResult || validationResult.isValid) {
    return ''
  }

  const issuesSection = formatValidationIssues(validationResult.issues)
  const metrics = validationResult.metrics
  const issueCount = validationResult.issues.length

  return `## ⚠️ PR Review Skipped
> ${issueCount} validation issue${issueCount === 1 ? '' : 's'} found. Review thresholds can be adjusted in \`.revu.yml\`.

<details>
<summary>See why it was skipped and detailed metrics</summary>

${issuesSection}

### PR Metrics
- **Total files changed:** ${metrics.filesChanged}
- **Reviewable files:** ${metrics.reviewableFilesChanged}
- **Diff size:** ${metrics.diffSize} lines
- **Documentation files:** ${metrics.documentationOnlyFiles}
${metrics.largestFileSize ? `- **Largest file change:** ${metrics.largestFileSize} lines` : ''}
${metrics.additionDeletionRatio !== undefined ? `- **Addition/Deletion ratio:** ${metrics.additionDeletionRatio.toFixed(2)}` : ''}

---

*This validation helps ensure the bot focuses on PRs where automated review provides the most value.*
</details>`
}

const logValidationResult = (
  validationResult: ReviewResult['validationResult'],
  _prNumber: number,
  _repository: string
): void => {
  if (!validationResult) return

  const { metrics, isValid, issues } = validationResult

  console.log(`✓ PR validation completed`)
  console.log(
    `  - Files changed: ${metrics.filesChanged} (${metrics.reviewableFilesChanged} reviewable)`
  )
  console.log(`  - Diff size: ${metrics.diffSize} lines`)

  if (metrics.largestFileSize) {
    console.log(`  - Largest file change: ${metrics.largestFileSize} lines`)
  }

  if (metrics.additionDeletionRatio !== undefined) {
    console.log(
      `  - Addition/deletion ratio: ${metrics.additionDeletionRatio.toFixed(2)}`
    )
  }

  if (!isValid) {
    console.log(`⚠ PR validation failed: ${issues.length} issue(s) found`)
    issues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue.reason}`)
    })
  } else {
    console.log(`✓ PR validation passed`)
  }
}

// Core validation function
const performValidation = async (
  context: ReviewContext
): Promise<ReviewResult['validationResult']> => {
  const { platformContext, prNumber, options } = context
  const repository =
    options.repository ||
    `${platformContext.repoOwner}/${platformContext.repoName}`

  try {
    console.log('⚡ Loading validation configuration...')
    const validationConfig = await getValidationConfig(options.repoPath)

    console.log('⚡ Validating PR...')
    const validationResult = await validatePR(
      platformContext.client,
      prNumber,
      validationConfig
    )

    logValidationResult(validationResult, prNumber, repository)
    return validationResult
  } catch (error) {
    logSystemError(`Validation failed: ${error.message}`, {
      pr_number: prNumber,
      repository
    })
    // Return a permissive result on validation error (fail open)
    return {
      isValid: true,
      issues: [],
      metrics: {
        filesChanged: 0,
        reviewableFilesChanged: 0,
        diffSize: 0,
        documentationOnlyFiles: 0
      }
    }
  }
}

// Core analysis function
const performAnalysis = async (
  context: ReviewContext,
  strategyName: string
): Promise<string> => {
  const { repositoryUrl, branch, platformContext } = context

  console.log(`⚡ Starting analysis with strategy: ${strategyName}`)
  console.log('   (This may take 30-60 seconds...)')

  const startTime = Date.now()
  const analysis = await sendToLLM({
    repositoryUrl,
    branch,
    strategyName,
    context: platformContext
  })

  const duration = (Date.now() - startTime) / 1000
  console.log(`✓ Analysis completed in ${duration.toFixed(2)} seconds`)

  return analysis
}

// Comment submission function
const submitComments = async (
  context: ReviewContext,
  analysis: string
): Promise<string> => {
  const { platformContext, prNumber, options } = context
  const repository =
    options.repository ||
    `${platformContext.repoOwner}/${platformContext.repoName}`
  const reviewStartTime = Date.now()

  console.log('⚡ Submitting comments to GitHub...')

  try {
    const result = await lineCommentsHandler(
      platformContext,
      prNumber,
      analysis,
      options.reviewType || 'on-demand',
      repository,
      reviewStartTime
    )

    console.log('✓ Comments submitted successfully')
    return result || 'Comments submitted successfully'
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: repository,
      context_msg: '⚠ Error submitting line comments'
    })
    const errorMessage = `Error processing line comments: ${error.message || String(error)}`
    await errorCommentHandler(platformContext, prNumber, errorMessage)
    throw new Error(`Comment submission failed: ${error.message}`)
  }
}

// Main review orchestration function
export const performCompleteReview = async (
  repositoryUrl: string,
  prNumber: number,
  branch: string,
  platformContext: PlatformContext,
  options: ReviewOptions
): Promise<ReviewResult> => {
  const repository =
    options.repository ||
    `${platformContext.repoOwner}/${platformContext.repoName}`
  const reviewType = options.reviewType || 'on-demand'

  // Create review context
  const context: ReviewContext = {
    repositoryUrl,
    prNumber,
    branch,
    platformContext,
    options
  }

  logReviewStarted(prNumber, repository, reviewType)

  try {
    // Step 1: Validate PR
    const validationResult = await performValidation(context)

    if (!validationResult.isValid) {
      // Handle validation failure
      const validationMessage = createValidationMessage(validationResult)

      if (options.submitComments) {
        await errorCommentHandler(platformContext, prNumber, validationMessage)
      }

      return {
        success: false,
        validationResult,
        message: 'PR validation failed - review skipped'
      }
    }

    // Step 2: Get strategy configuration
    console.log('⚡ Loading review strategy...')
    const strategyName = await chooseStrategy(options)

    // Step 3: Perform analysis
    const analysis = await performAnalysis(context, strategyName)

    // Step 4: Handle comments (submit or return for display)
    let message: string
    if (options.submitComments) {
      message = await submitComments(context, analysis)
    } else {
      message = 'Analysis completed - use --submit to post comments'
    }

    return {
      success: true,
      analysis,
      validationResult,
      message
    }
  } catch (error) {
    const errorMessage = error.message || String(error)

    // Parse HTTP status code if present in format "400 {JSON}"
    const spaceIndex = errorMessage.indexOf(' ')
    if (spaceIndex > 0) {
      const statusPart = errorMessage.substring(0, spaceIndex)
      if (/^\d{3}$/.test(statusPart)) {
        const statusCode = parseInt(statusPart)
        const jsonError = errorMessage.substring(spaceIndex + 1)
        logReviewFailed(prNumber, repository, reviewType, jsonError, statusCode)
      } else {
        logReviewFailed(prNumber, repository, reviewType, errorMessage)
      }
    } else {
      logReviewFailed(prNumber, repository, reviewType, errorMessage)
    }

    // Try to post error comment if submitting
    if (options.submitComments) {
      try {
        await errorCommentHandler(platformContext, prNumber, errorMessage)
      } catch (commentError) {
        logSystemError(
          `Failed to post error comment: ${commentError.message || String(commentError)}`,
          { pr_number: prNumber, repository }
        )
      }
    }

    return {
      success: false,
      error: errorMessage,
      message: `Review failed: ${errorMessage}`
    }
  }
}
