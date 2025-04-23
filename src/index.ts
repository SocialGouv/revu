import { config } from 'dotenv'
import { Probot, type Context } from 'probot'
import { sendToAnthropic } from './send-to-anthropic.ts'

// Load environment variables
config()

// Marker to identify our AI analysis comments
const COMMENT_MARKER = '<!-- REVU-AI-ANALYSIS -->'

export default async (app: Probot, { getRouter }) => {
  app.log.info('Revu GitHub App started!')

  // Container health check route
  getRouter('/healthz').get('/', (req, res) => res.end('OK'))

  /**
   * Find existing AI analysis comment by looking for the unique marker
   */
  async function findExistingAnalysisComment(context: Context, prNumber) {
    const repo = context.repo()

    // Get all comments on the PR
    const { data: comments } = await context.octokit.issues.listComments({
      ...repo,
      issue_number: prNumber
    })

    // Find the comment with our marker
    return comments.find((comment) => comment.body.includes(COMMENT_MARKER))
  }

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

        // Format the analysis with our marker
        const formattedAnalysis = `${COMMENT_MARKER}\n\n${analysis}`

        // Check if we already have an analysis comment
        const existingComment = await findExistingAnalysisComment(
          context,
          pr.number
        )

        if (existingComment) {
          // Update the existing comment
          await context.octokit.issues.updateComment({
            ...repo,
            comment_id: existingComment.id,
            body: formattedAnalysis
          })
          app.log.info(`Updated existing analysis comment on PR #${pr.number}`)
        } else {
          // Post a new comment
          await context.octokit.issues.createComment({
            ...repo,
            issue_number: pr.number,
            body: formattedAnalysis
          })
          app.log.info(`Created new analysis comment on PR #${pr.number}`)
        }

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
