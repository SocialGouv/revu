import { config } from 'dotenv'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Probot } from 'probot'
import { getCommentHandler } from './comment-handlers/index.ts'
import { sendToAnthropic } from './send-to-anthropic.ts'

// Load environment variables
config()

export default async (app: Probot, { getRouter }) => {
  app.log.info('Revu GitHub App started!')

  // Container health check route
  getRouter('/healthz').get('/', (req, res) => res.end('OK'))

  // Listen for PR opens and updates
  app.on(
    ['pull_request.opened', 'pull_request.synchronize'],
    async (context) => {
      const pr = context.payload.pull_request
      const repo = context.repo()

      app.log.info(`Processing PR #${pr.number} in ${repo.owner}/${repo.repo}`)

      try {
        // Get repository URL and branch from PR
        const repositoryUrl = `https://github.com/${repo.owner}/${repo.repo}.git`
        const branch = pr.head.ref

        // Get an installation token for authentication with private repositories
        const installationId = context.payload.installation.id
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
        app.log.info(`Successfully analyzed PR #${pr.number}`)
      } catch (error) {
        app.log.error(`Error processing PR #${pr.number}: ${error}`)
      }
    }
  )

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
