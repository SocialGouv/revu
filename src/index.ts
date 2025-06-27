import { config } from 'dotenv'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Context, Probot } from 'probot'
import { errorCommentHandler } from './comment-handlers/error-comment-handler.ts'
import { getCommentHandler } from './comment-handlers/index.ts'
import {
  addBotAsReviewer,
  getProxyReviewerUsername,
  isPRCreatedByBot,
  isPRDraft,
  isReviewRequestedForBot
} from './github/reviewer-utils.ts'
import type { PromptContext } from './prompt-strategies/prompt-strategy.ts'
import { sendToAnthropic } from './send-to-anthropic.ts'
import {
  logAppStarted,
  logReviewStarted,
  logReviewFailed,
  logReviewerAdded,
  logSystemError
} from './utils/logger.ts'

// Load environment variables
config()

export default async (app: Probot, { getRouter }) => {
  logAppStarted()

  // Container health check route
  getRouter('/healthz').get('/', (req, res) => res.end('OK'))

  // Listen for PR opens to add bot as reviewer
  app.on(['pull_request.opened'], async (context) => {
    const payload = context.payload as {
      pull_request: {
        number: number
        head: { ref: string }
        user: { login: string; type: string }
      }
    }
    const pr = payload.pull_request
    const repo = context.repo()

    // Check if PR is created by a bot
    if (isPRCreatedByBot(pr.user)) {
      // Skip bot-created PRs silently
      return
    }

    try {
      await addBotAsReviewer(context)
      logReviewerAdded(pr.number, `${repo.owner}/${repo.repo}`)
    } catch (error) {
      logSystemError(
        `Error adding bot as reviewer: ${error.message || String(error)}`,
        { pr_number: pr.number, repository: `${repo.owner}/${repo.repo}` }
      )
    }
  })

  // Listen for review requests to perform on-demand analysis
  app.on(['pull_request.review_requested'], async (context) => {
    // Cast payload to a more flexible type for the review request check
    const reviewPayload = context.payload as {
      action: string
      requested_reviewer?: {
        login: string
        type: string
      }
      pull_request: {
        number: number
        head: { ref: string }
        title: string
        body: string | null
        draft: boolean
      }
      repository: {
        name: string
        owner: {
          login: string
        }
      }
      installation: { id: number }
    }
    const pr = reviewPayload.pull_request

    // Get the proxy username for review detection
    const proxyUsername = getProxyReviewerUsername()
    if (!proxyUsername) {
      logSystemError(
        'PROXY_REVIEWER_USERNAME not configured, aborting review request'
      )
      return
    }

    // Check if the review request is for our proxy user
    if (!isReviewRequestedForBot(reviewPayload, proxyUsername)) {
      // Skip reviews requested for other users silently
      return
    }

    // Check if PR is in draft status
    if (isPRDraft(pr)) {
      // Skip draft PRs silently - will review when ready
      return
    }

    await handlePRReview(context, reviewPayload, 'on-demand')
  })

  // Listen for PR ready for review to automatically perform analysis
  app.on(['pull_request.ready_for_review'], async (context) => {
    const payload = context.payload as {
      pull_request: {
        number: number
        head: { ref: string }
        title: string
        body: string | null
        user: { login: string; type: string }
      }
      installation: { id: number }
    }
    const pr = payload.pull_request

    // Check if PR is created by a bot
    if (isPRCreatedByBot(pr.user)) {
      // Skip bot-created PRs silently
      return
    }

    await handlePRReview(context, payload, 'automatic')
  })

  /**
   * Handles PR review processing for both on-demand and automatic reviews
   * This function encapsulates the common logic for processing PR reviews
   */
  async function handlePRReview(
    context: Context,
    payload: {
      pull_request: {
        number: number
        head: { ref: string }
        title: string
        body: string | null
        draft?: boolean // Make optional since ready_for_review doesn't include it
      }
      installation: { id: number }
    },
    reviewType: 'on-demand' | 'automatic'
  ) {
    const pr = payload.pull_request
    const repo = context.repo()
    const repository = `${repo.owner}/${repo.repo}`

    logReviewStarted(pr.number, repository, reviewType)

    try {
      // Get repository URL and branch from PR
      const repositoryUrl = `https://github.com/${repo.owner}/${repo.repo}.git`
      const branch = pr.head.ref

      // Get an installation token for authentication with private repositories
      const installationId = payload.installation.id
      const installationAccessToken = await context.octokit.apps
        .createInstallationAccessToken({
          installation_id: installationId
        })
        .then((response) => response.data.token)

      // Get the current strategy from configuration
      const strategyName = await getStrategyNameFromConfig()

      // Prepare context for prompt generation (includes PR title and body)
      const promptContext = {
        prNumber: pr.number,
        prTitle: pr.title,
        prBody: pr.body || undefined,
        repoOwner: repo.owner,
        repoName: repo.repo,
        githubContext: context
      }

      // Perform the complete review analysis with context
      const reviewStartTime = Date.now()
      await performReviewAnalysis(
        context,
        pr.number,
        repositoryUrl,
        branch,
        installationAccessToken,
        strategyName,
        promptContext,
        reviewType,
        repository,
        reviewStartTime
      )

      // Review completion will be logged in the comment handler
    } catch (error) {
      logReviewFailed(
        pr.number,
        repository,
        reviewType,
        error.message || String(error)
      )

      // Use the sophisticated error comment handler from main
      try {
        await errorCommentHandler(
          context,
          pr.number,
          error.message || String(error)
        )
      } catch (commentError) {
        logSystemError(
          `Failed to post error comment: ${commentError.message || String(commentError)}`,
          { pr_number: pr.number, repository }
        )
      }
    }
  }

  /**
   * Gets the strategy name from the configuration file
   */
  async function getStrategyNameFromConfig() {
    try {
      const configPath = path.join(process.cwd(), 'config.json')
      const configContent = await fs.readFile(configPath, 'utf-8')
      const config = JSON.parse(configContent)
      return config.promptStrategy || 'default'
    } catch (error) {
      console.error('Error reading configuration:', error)
      return 'default'
    }
  }

  /**
   * Performs a complete review analysis for a PR
   * This function encapsulates the common logic for analyzing PRs and posting comments
   */
  async function performReviewAnalysis(
    context: Context,
    prNumber: number,
    repositoryUrl: string,
    branch: string,
    installationAccessToken: string,
    strategyName?: string,
    promptContext?: PromptContext,
    reviewType?: 'on-demand' | 'automatic',
    repository?: string,
    reviewStartTime?: number
  ): Promise<string> {
    // Get the current strategy from configuration if not provided
    const finalStrategyName =
      strategyName || (await getStrategyNameFromConfig())

    // Get the analysis from Anthropic with context
    const analysis = await sendToAnthropic({
      repositoryUrl,
      branch,
      token: installationAccessToken,
      strategyName: finalStrategyName,
      context: promptContext
    })

    // Get the appropriate comment handler based on the strategy
    const commentHandler = getCommentHandler(finalStrategyName)

    // Handle the analysis with the appropriate handler - pass additional params for structured logging
    const result = await commentHandler(
      context,
      prNumber,
      analysis,
      reviewType,
      repository,
      reviewStartTime
    )

    return result || 'Review completed successfully'
  }
}
