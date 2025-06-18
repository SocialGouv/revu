import { config } from 'dotenv'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Probot } from 'probot'
import { getCommentHandler } from './comment-handlers/index.ts'
import { sendToAnthropic } from './send-to-anthropic.ts'
import {
  addBotAsReviewer,
  isReviewRequestedForBot
} from './github/reviewer-utils.ts'

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
      installation: { id: number }
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

    // Check if the review request is for our bot
    if (!isReviewRequestedForBot(reviewPayload)) {
      app.log.info('Review requested for someone else, ignoring')
      return
    }

    const payload = context.payload as {
      pull_request: {
        number: number
        head: { ref: string }
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

      // Get the analysis from Anthropic
      const analysis = await sendToAnthropic({
        repositoryUrl,
        branch,
        token: installationAccessToken,
        strategyName
      })

      // Get the appropriate comment handler based on the strategy
      const commentHandler = getCommentHandler(strategyName)

      // Handle the analysis with the appropriate handler
      const result = await commentHandler(context, pr.number, analysis)

      app.log.info(result)
      app.log.info(
        `Successfully completed on-demand review for PR #${pr.number}`
      )
    } catch (error) {
      app.log.error(
        `Error performing on-demand review for PR #${pr.number}: ${error}`
      )
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
}
