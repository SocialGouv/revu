import type { Context } from 'probot'
import type { PlatformStore } from '../index.ts'
import type { WebhookEvents } from '@octokit/webhooks/types'
import { logReviewerAdded } from '../../utils/logger.ts'
import type { PlatformContext } from '../../core/models/platform-types.ts'
import { getContextOctokit } from './context-utils.ts'
import { createGitHubClient } from './github-client.ts'

interface PullRequestOpenedPayload {
  pull_request: {
    number: number
    head: { ref: string }
    user: { login: string; type: string }
    requested_reviewers?: Array<{ login: string; type: string }>
  }
}

interface ReviewRequestedPayload {
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

interface ReadyForReviewPayload {
  pull_request: {
    number: number
    head: { ref: string }
    title: string
    body: string | null
    user: { login: string; type: string }
  }
  installation: { id: number }
}

export default class GithubStore implements PlatformStore {
  private readonly octokitContext: Context<WebhookEvents>

  constructor(context: Context<WebhookEvents>) {
    this.octokitContext = context
  }
  getRepositoryAndBranch(): {
    repositoryUrl: string
    branch: string
  } {
    const repo = this.octokitContext.repo()
    return {
      repositoryUrl: `https://github.com/${repo.owner}/${repo.repo}.git`,
      branch: (
        this.octokitContext.payload as
          | PullRequestOpenedPayload
          | ReviewRequestedPayload
      ).pull_request.head.ref
    }
  }

  async createPlatformContext(): Promise<PlatformContext> {
    const payload = this.octokitContext.payload as
      | ReviewRequestedPayload
      | ReadyForReviewPayload
    const installationId = payload.installation.id
    const token = await this.octokitContext.octokit.rest.apps
      .createInstallationAccessToken({
        installation_id: installationId
      })
      .then((response) => response.data.token)
    const pr = payload.pull_request
    const repo = this.octokitContext.repo()
    const octokit = getContextOctokit(this.octokitContext)

    return {
      repoOwner: repo.owner,
      repoName: repo.repo,
      prNumber: pr.number,
      prTitle: pr.title,
      prBody: pr.body || undefined,
      client: createGitHubClient(octokit, repo.owner, repo.repo, token)
    }
  }

  isPRCreatedByBot(): boolean {
    const payload = this.octokitContext.payload as
      | PullRequestOpenedPayload
      | ReadyForReviewPayload
    const user = payload.pull_request.user
    if (!user || typeof user.type !== 'string') {
      return false
    }
    return user.type.toLowerCase() === 'bot'
  }

  async addBotAsReviewer(proxyReviewerUsername: string): Promise<void> {
    const context = this.octokitContext
    try {
      const payload = context.payload as PullRequestOpenedPayload
      const pr = payload.pull_request
      const repo = context.repo()

      // Check if proxy user is already a requested reviewer
      const isProxyAlreadyRequested = pr.requested_reviewers?.some(
        (reviewer: { login: string; type: string }) =>
          reviewer.login === proxyReviewerUsername
      )
      if (isProxyAlreadyRequested) {
        context.log.info(
          `Proxy user is already a requested reviewer for PR #${pr.number}`
        )
        return
      }

      // Add proxy user as reviewer
      await context.octokit.rest.pulls.requestReviewers({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pr.number,
        reviewers: [proxyReviewerUsername]
      })

      context.log.info(
        `Successfully added proxy user as reviewer for PR #${pr.number}`
      )
      logReviewerAdded(pr.number, `${repo.owner}/${repo.repo}`)
    } catch (error: any) {
      context.log.error(`Error adding bot as reviewer: ${error}`)
      context.log.error(`Error details:`, {
        message: error.message,
        status: error.status,
        response: error.response?.data,
        stack: error.stack
      })
    }
  }

  isReviewRequestedForBot(proxyReviewerUsername: string): boolean {
    const payload = this.octokitContext.payload as ReviewRequestedPayload
    return !!(
      payload.action === 'review_requested' &&
      payload.requested_reviewer &&
      payload.requested_reviewer.login === proxyReviewerUsername
    )
  }

  isPRDraft(): boolean {
    const payload = this.octokitContext.payload as ReviewRequestedPayload
    return payload.pull_request.draft === true
  }
}
