import * as fs from 'fs/promises'
import * as path from 'path'
import { errorCommentHandler } from '../../comment-handlers/error-comment-handler.ts'
import { lineCommentsHandler } from '../../comment-handlers/line-comments-handler.ts'
import { getValidationConfig } from '../../config-handler.ts'
import { sendToAnthropic } from '../../send-to-anthropic.ts'
import {
  logReviewFailed,
  logReviewStarted,
  logSystemError
} from '../../utils/logger.ts'
import type { PlatformContext } from '../models/platform-types.ts'
import { formatValidationIssues, validatePR } from './pr-validation-service.ts'

// Types
interface ReviewOptions {
  submitComments: boolean
  reviewType?: 'on-demand' | 'automatic'
  repoPath?: string
  repository?: string
  strategy?: string
}

interface ReviewResult {
  success: boolean
  analysis?: string
  validationResult?: {
    isValid: boolean
    issues: Array<{ reason: string; suggestion: string }>
    metrics: {
      filesChanged: number
      reviewableFilesChanged: number
      diffSize: number
      largestFileSize?: number
      additionDeletionRatio?: number
      documentationOnlyFiles: number
    }
  }
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

// Pure functions for configuration and validation
const getStrategyNameFromConfig = async (): Promise<string> => {
  try {
    const configPath = path.join(process.cwd(), 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(configContent)
    return config.promptStrategy || 'line-comments'
  } catch (error) {
    logSystemError(`Error reading configuration: ${error}`)
    return 'line-comments'
  }
}

// Strategy resolution with priority: options.strategy > config.json > default
const chooseStrategy = async (options: ReviewOptions): Promise<string> => {
  if (options.strategy) {
    return options.strategy
  }
  return await getStrategyNameFromConfig()
}

const createValidationMessage = (
  validationResult: ReviewResult['validationResult']
): string => {
  if (!validationResult || validationResult.isValid) {
    return ''
  }

  const issuesSection = formatValidationIssues(validationResult.issues)
  const metrics = validationResult.metrics

  return `## ⚠️ PR Review Skipped

${issuesSection}

### PR Metrics
- **Total files changed:** ${metrics.filesChanged}
- **Reviewable files:** ${metrics.reviewableFilesChanged}
- **Diff size:** ${metrics.diffSize} lines
- **Documentation files:** ${metrics.documentationOnlyFiles}
${metrics.largestFileSize ? `- **Largest file change:** ${metrics.largestFileSize} lines` : ''}
${metrics.additionDeletionRatio !== undefined ? `- **Addition/Deletion ratio:** ${metrics.additionDeletionRatio.toFixed(2)}` : ''}

---
*This validation helps ensure the bot focuses on PRs where automated review provides the most value. You can adjust these limits in your \`.revu.yml\` configuration file.*`
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
  const analysis = await sendToAnthropic({
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

    logReviewFailed(prNumber, repository, reviewType, errorMessage)

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
