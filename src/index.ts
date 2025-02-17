import { Probot } from 'probot'
import { sendToAnthropic } from './send-to-anthropic.ts'
import { config } from 'dotenv'

// Load environment variables
config()

export default async (app: Probot) => {
  app.log.info('Revu GitHub App started!')

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

        // Get the analysis from Anthropic
        const analysis = await sendToAnthropic({
          repositoryUrl,
          branch
        })

        // Post the analysis as a PR comment
        await context.octokit.issues.createComment({
          ...repo,
          issue_number: pr.number,
          body: analysis
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
