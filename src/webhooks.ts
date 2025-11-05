import { config } from 'dotenv'
import { Context, Probot } from 'probot'
import { shouldProcessBranch } from './config-handler.ts'
import type { PlatformContext } from './core/models/platform-types.ts'
import { performCompleteReview } from './core/services/review-service.ts'
import {
  addBotAsReviewer,
  getProxyReviewerUsername,
  isAutomatedSender,
  isPRCreatedByBot,
  isPRDraft,
  isReviewRequestedForBot
} from './github/reviewer-utils.ts'
import { createPlatformContextFromGitHub } from './platforms/github/github-adapter.ts'
import {
  logAppStarted,
  logReviewerAdded,
  logSystemError,
  logSystemWarning,
  logWebhookReceived
} from './utils/logger.ts'
import { attachOctokitRetry } from './github/retry-hook.ts'

// Load environment variables
config()

export default async (app: Probot) => {
  logAppStarted()

  // Log all GitHub webhook events for monitoring and debugging
  app.onAny(async (context) => {
    logWebhookReceived(context.name, context.payload)
  })

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

    // Ensure all Probot Octokit requests are retried via centralized hook
    attachOctokitRetry(context.octokit, {
      repository: `${repo.owner}/${repo.repo}`,
      pr_number: pr.number
    })

    // Check if PR is created by a bot
    if (isPRCreatedByBot(pr.user)) {
      // Skip bot-created PRs silently
      return
    }

    try {
      await addBotAsReviewer(context)
      logReviewerAdded(pr.number, `${repo.owner}/${repo.repo}`)
    } catch (error) {
      logSystemError(error, {
        pr_number: pr.number,
        repository: `${repo.owner}/${repo.repo}`,
        context_msg: 'Failed to add bot as reviewer'
      })
    }
  })

  // Listen for review requests to perform on-demand analysis
  app.on(['pull_request.review_requested'], async (context) => {
    // Cast payload to a more flexible type for the review request check
    const reviewPayload = context.payload as {
      action: string
      sender: {
        login: string
        type: string
      }
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
        new Error(
          'PROXY_REVIEWER_USERNAME not configured, aborting review request'
        )
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

    // Determine review type based on sender
    const reviewType = isAutomatedSender(reviewPayload.sender, proxyUsername)
      ? 'automatic'
      : 'on-demand'

    await handlePRReview(context, reviewPayload, reviewType)
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
  ): Promise<void> {
    const pr = payload.pull_request
    const repo = context.repo()
    const repository = `${repo.owner}/${repo.repo}`

    // Ensure all Probot Octokit requests are retried via centralized hook
    attachOctokitRetry(context.octokit, { repository, pr_number: pr.number })

    // Get an installation token for authentication with private repositories
    const installationId = payload.installation.id
    const installationAccessToken = await context.octokit.rest.apps
      .createInstallationAccessToken({
        installation_id: installationId
      })
      .then((response) => response.data.token)

    let platformContext: PlatformContext
    try {
      // Prepare platform-agnostic context for prompt generation
      platformContext = createPlatformContextFromGitHub(
        context,
        pr.number,
        pr.title,
        pr.body || undefined,
        installationAccessToken
      )
    } catch (error) {
      logSystemError(error, {
        pr_number: pr.number,
        repository,
        context_msg: 'Failed to create platform context'
      })
      return
    }

    // Get repository URL and branch from PR
    const repositoryUrl = `https://github.com/${repo.owner}/${repo.repo}.git`
    const branch = pr.head.ref

    // Branch filter via .revu.yml (fail-open handled inside helper)
    const decision = await shouldProcessBranch(branch)
    if (!decision.allowed) {
      logSystemWarning('Branch filtered by .revu.yml branches', {
        pr_number: pr.number,
        repository,
        context_msg: `Skipping review for filtered branch ${branch}`
      })
      return
    }

    try {
      const result = await performCompleteReview(
        repositoryUrl,
        pr.number,
        branch,
        platformContext,
        {
          submitComments: true,
          reviewType,
          repository
        }
      )

      // The review service handles all logging and error posting
      if (!result.success && result.error) {
        logSystemError(result.error, {
          pr_number: pr.number,
          repository: repository,
          context_msg: 'Review service failed to process PR'
        })
      }
    } catch (error) {
      logSystemError(error, {
        pr_number: pr.number,
        repository,
        context_msg: 'Unexpected error in review service'
      })
    }
  }
}
