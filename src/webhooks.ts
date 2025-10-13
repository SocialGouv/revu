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
import { COMMENT_MARKER_PREFIX } from './comment-handlers/types.ts'
import { handleDiscussionReply } from './comment-handlers/discussion-handler.ts'
import { isUserAllowedForRepo } from './github/membership.ts'
import { evictDiscussionCacheByReply } from './utils/compute-cache.ts'
import { checkAndConsumeRateLimit } from './utils/rate-limit.ts'

// Load environment variables
config()

export default async (app: Probot) => {
  logAppStarted()

  // Log all GitHub webhook events for monitoring and debugging
  app.onAny(async (context) => {
    logWebhookReceived(context.name, context.payload)
  })

  // Listen for replies to Revu comments to start a discussion
  app.on(['pull_request_review_comment.created'], async (context) => {
    const payload = context.payload as {
      action: string
      comment: { id: number; in_reply_to_id?: number | null; body: string }
      pull_request: {
        number: number
        head: { ref: string }
        title: string
        body: string | null
      }
      repository: {
        name: string
        owner: { login: string; type?: string }
      }
      sender: { login: string; type: string }
      organization?: { login: string }
      installation: { id: number }
    }

    // Only handle replies to existing comments
    if (!payload.comment?.in_reply_to_id) return

    // Only react to human users
    if ((payload.sender?.type || '').toLowerCase() !== 'user') return

    // Ensure reply is to a Revu comment by our proxy user
    const proxyUsername = getProxyReviewerUsername()
    if (!proxyUsername) return

    let parent
    try {
      parent = await context.octokit.rest.pulls.getReviewComment({
        ...context.repo(),
        comment_id: payload.comment.in_reply_to_id
      })
    } catch {
      return
    }

    const parentBody: string = parent?.data?.body || ''
    const parentAuthor: string | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parent?.data as any)?.user?.login

    if (!parentBody.includes(COMMENT_MARKER_PREFIX)) return
    if (parentAuthor !== proxyUsername) return

    // Authorization: only org members (or at least repo collaborators)
    const orgLogin =
      payload.organization?.login ||
      ((payload.repository.owner as unknown as { login: string; type?: string })
        .type === 'Organization'
        ? payload.repository.owner.login
        : undefined)

    const fallbackToRepo =
      (process.env.AUTHZ_FALLBACK_TO_REPO || '').toLowerCase() === 'true'

    if (fallbackToRepo) {
      logSystemWarning(
        'Authorization fallback to repo collaborators is enabled',
        {
          repository: `${payload.repository.owner.login}/${payload.repository.name}`,
          pr_number: payload.pull_request.number,
          context_msg:
            'AUTHZ_FALLBACK_TO_REPO=true - using repo collaborator permission when org membership is not available'
        }
      )
    }

    const allowed = await isUserAllowedForRepo(context.octokit, {
      org: orgLogin,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      username: payload.sender.login,
      fallbackToRepo
    })
    if (!allowed) return

    // Rate limiting - protect from abuse before expensive operations
    try {
      const rate = await checkAndConsumeRateLimit({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        prNumber: payload.pull_request.number,
        username: payload.sender.login
      })
      if (!rate.allowed) {
        logSystemWarning(
          `Rate limit exceeded for ${payload.sender.login}: ${rate.count}/${rate.limit}`,
          {
            repository: `${payload.repository.owner.login}/${payload.repository.name}`,
            pr_number: payload.pull_request.number,
            context_msg: 'Discussion reply skipped due to rate limiting'
          }
        )
        return
      }
    } catch (error) {
      logSystemWarning(error, {
        repository: `${payload.repository.owner.login}/${payload.repository.name}`,
        pr_number: payload.pull_request.number,
        context_msg:
          'Rate limiting check failed - proceeding without enforcement'
      })
    }

    // Prepare platform context using installation token
    let installationAccessToken: string | undefined
    try {
      installationAccessToken = await context.octokit.rest.apps
        .createInstallationAccessToken({
          installation_id: payload.installation.id
        })
        .then((r) => r.data.token)
    } catch (error) {
      logSystemError(error, {
        pr_number: payload.pull_request.number,
        repository: `${payload.repository.owner.login}/${payload.repository.name}`,
        context_msg: 'Failed to create installation access token for discussion'
      })
      return
    }

    let platformContext: PlatformContext
    try {
      platformContext = createPlatformContextFromGitHub(
        context,
        payload.pull_request.number,
        payload.pull_request.title,
        payload.pull_request.body || undefined,
        installationAccessToken
      )
    } catch (error) {
      logSystemError(error, {
        pr_number: payload.pull_request.number,
        repository: `${payload.repository.owner.login}/${payload.repository.name}`,
        context_msg: 'Failed to create platform context for discussion'
      })
      return
    }

    const repositoryUrl = `https://github.com/${payload.repository.owner.login}/${payload.repository.name}.git`
    const branch = payload.pull_request.head.ref

    try {
      await handleDiscussionReply({
        platformContext,
        prNumber: payload.pull_request.number,
        repositoryUrl,
        branch,
        parentCommentId: parent.data.id,
        parentCommentBody: parentBody,
        userReplyCommentId: payload.comment.id,
        userReplyBody: payload.comment.body,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        // Version for cache and race-condition guard
        replyVersion:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload as any)?.comment?.updated_at ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload as any)?.comment?.created_at
      })
    } catch (error) {
      logSystemError(error, {
        pr_number: payload.pull_request.number,
        repository: `${payload.repository.owner.login}/${payload.repository.name}`,
        context_msg: 'Failed to handle discussion reply'
      })
    }
  })

  // Listen for edits to user replies to handle cache invalidation
  app.on(['pull_request_review_comment.edited'], async (context) => {
    const payload = context.payload as {
      comment: { id: number; in_reply_to_id?: number | null }
      pull_request: { number: number }
      repository: { name: string; owner: { login: string } }
    }

    // Only consider edits to replies (not root comments)
    if (!payload.comment?.in_reply_to_id) return

    try {
      await evictDiscussionCacheByReply({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        prNumber: payload.pull_request.number,
        replyId: payload.comment.id
      })
    } catch (error) {
      logSystemError(error, {
        pr_number: payload.pull_request.number,
        repository: `${payload.repository.owner.login}/${payload.repository.name}`,
        context_msg: 'Failed to evict discussion cache on comment edit'
      })
    }
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
