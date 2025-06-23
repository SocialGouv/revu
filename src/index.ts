import { config } from 'dotenv'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Context, Probot } from 'probot'
import { errorCommentHandler } from './comment-handlers/error-comment-handler.ts'
import { getCommentHandler } from './comment-handlers/index.ts'
import {
  addBotAsReviewer,
  getBotUsername,
  isReviewRequestedForBot
} from './github/reviewer-utils.ts'
import type { PromptContext } from './prompt-strategies/prompt-strategy.ts'
import { sendToAnthropic } from './send-to-anthropic.ts'

// Load environment variables
config()

export default async (app: Probot, { getRouter }) => {
  app.log.info('Revu GitHub App started!')

  // Container health check route
  getRouter('/healthz').get('/', (req, res) => res.end('OK'))

  // Listen for PR opens to add bot as reviewer
  app.on(['pull_request.opened'], async (context) => {
    const payload = context.payload as {
      pull_request: {
        number: number
        head: { ref: string }
      }
    }
    const pr = payload.pull_request
    const repo = context.repo()

    app.log.info(
      `Adding bot as reviewer for PR #${pr.number} in ${repo.owner}/${repo.repo}`
    )

    try {
      await addBotAsReviewer(context)
      app.log.info(`Successfully added bot as reviewer for PR #${pr.number}`)
    } catch (error) {
      app.log.error(
        `Error adding bot as reviewer for PR #${pr.number}: ${error}`
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
      }
      repository: {
        name: string
        owner: {
          login: string
        }
      }
    }

    // Get the bot username dynamically to avoid race conditions
    let botUsername: string
    try {
      botUsername = await getBotUsername(context)
    } catch (error) {
      app.log.error(
        `Failed to get bot username, aborting review request: ${error}`
      )
      return
    }

    // Check if the review request is for our bot
    if (!isReviewRequestedForBot(reviewPayload, botUsername)) {
      app.log.info('Review requested for someone else, ignoring')
      return
    }

    const payload = context.payload as {
      pull_request: {
        number: number
        head: { ref: string }
        title: string
        body: string | null
      }
      installation: { id: number }
    }
    const pr = payload.pull_request
    const repo = context.repo()

    app.log.info(
      `Performing on-demand review for PR #${pr.number} in ${repo.owner}/${repo.repo}`
    )

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
      const result = await performReviewAnalysis(
        context,
        pr.number,
        repositoryUrl,
        branch,
        installationAccessToken,
        strategyName,
        promptContext
      )

      app.log.info(result)
      app.log.info(
        `Successfully completed on-demand review for PR #${pr.number}`
      )
    } catch (error) {
      app.log.error(
        `Error performing on-demand review for PR #${pr.number}: ${error}`
      )

      // Use the sophisticated error comment handler from main
      try {
        await errorCommentHandler(
          context,
          pr.number,
          error.message || String(error)
        )
        app.log.info(`Posted error comment on PR #${pr.number}`)
      } catch (commentError) {
        app.log.error(
          `Failed to post error comment on PR #${pr.number}: ${commentError}`
        )
      }
    }
  })

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
    promptContext?: PromptContext
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

    // Handle the analysis with the appropriate handler
    const result = await commentHandler(context, prNumber, analysis)

    return result || 'Review completed successfully'
  }
}
