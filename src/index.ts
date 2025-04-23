import { config } from 'dotenv'
import { Probot } from 'probot'
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

        // Get the analysis from Anthropic
        const analysis = await sendToAnthropic({
          repositoryUrl,
          branch,
          token: installationAccessToken
        })

        // Post the analysis as a PR review
        await context.octokit.pulls.createReview({
          ...repo,
          pull_number: pr.number,
          body: analysis,
          event: 'COMMENT' // Using COMMENT as default since we're not making approval decisions
        })

        app.log.info(`Successfully analyzed PR #${pr.number}`)
      } catch (error) {
        app.log.error(`Error processing PR #${pr.number}: ${error}`)

        // Post error as a PR comment
        await context.octokit.issues.createComment({
          ...repo,
          issue_number: pr.number,
          body: `⚠️ Error analyzing this PR:\n\`\`\`\n${error}\n\`\`\``
        })
      }
    }
  )
}
