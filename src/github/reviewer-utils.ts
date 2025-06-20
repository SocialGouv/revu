import { Context } from 'probot'

interface GitHubEvent {
  action: string
  requested_reviewer?: {
    login: string
    type: string
  }
  pull_request: {
    number: number
    requested_reviewers?: Array<{ login: string; type: string }>
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
}

/**
/**
 * Checks if a review request is specifically for the Revu bot
 */
export function isReviewRequestedForBot(event: GitHubEvent, botUsername: string = 'revu-bot[bot]'): boolean {
  return Boolean(
    event.action === 'requested' &&
      event.requested_reviewer &&
      event.requested_reviewer.login === botUsername
  )
}
}

/**
 * Checks if the event is a pull request opened event
 */
export function isPullRequestOpened(event: GitHubEvent): boolean {
  return event.action === 'opened'
}

/**
 * Extracts PR information from GitHub event
 */
export function extractPRInfo(event: GitHubEvent): {
  number: number
  owner: string
  repo: string
} {
  return {
    number: event.pull_request.number,
    owner: event.repository.owner.login,
    repo: event.repository.name
  }
}

/**
 * Adds the Revu bot as a reviewer to a pull request
 */
export async function addBotAsReviewer(context: Context): Promise<void> {
  try {
    const payload = context.payload as {
      pull_request: {
        number: number
        requested_reviewers?: Array<{ login: string; type: string }>
      }
    }
    const pr = payload.pull_request
    const repo = context.repo()

    // Check if bot is already a requested reviewer
    const isBotAlreadyRequested = pr.requested_reviewers?.some(
      (reviewer: { login: string; type: string }) =>
        reviewer.login === 'revu-bot[bot]'
    )

    if (isBotAlreadyRequested) {
      context.log.info(
        `Bot is already a requested reviewer for PR #${pr.number}`
      )
      return
    }

    // Add bot as reviewer
    await context.octokit.pulls.requestReviewers({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: pr.number,
      reviewers: ['revu-bot[bot]']
    })

    context.log.info(`Successfully added bot as reviewer for PR #${pr.number}`)
  } catch (error) {
    context.log.error(`Error adding bot as reviewer: ${error}`)
    // Don't throw error to avoid breaking the workflow
  }
}

/**
 * Gets the bot's username from the GitHub App
 */
export async function getBotUsername(context: Context): Promise<string> {
  try {
    const app = await context.octokit.apps.getAuthenticated()
    return `${app.data.slug}[bot]`
  } catch (error) {
    context.log.error(`Error getting bot username: ${error}`)
    return 'revu-bot[bot]' // fallback
  }
}
