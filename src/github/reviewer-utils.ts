import { Context } from 'probot'

// Cache for bot username to avoid repeated API calls
let cachedBotUsername: string | null = null

/**
 * Resets the bot username cache (primarily for testing)
 */
export function resetBotUsernameCache(): void {
  cachedBotUsername = null
}

/**
 * Gets the proxy reviewer username from environment variables
 */
export function getProxyReviewerUsername(): string | null {
  return process.env.PROXY_REVIEWER_USERNAME || null
}

/**
 * Checks if a PR was created by a bot based on the user type
 */
export function isPRCreatedByBot(user: {
  login: string
  type: string
}): boolean {
  if (!user || typeof user.type !== 'string') {
    return false
  }
  return user.type.toLowerCase() === 'bot'
}

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

export function isReviewRequestedForBot(
  event: GitHubEvent,
  botUsername: string
): boolean {
  return !!(
    event.action === 'review_requested' &&
    event.requested_reviewer &&
    event.requested_reviewer.login === botUsername
  )
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
 * Adds the proxy user as a reviewer to a pull request
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

    // Get the proxy reviewer username
    const proxyUsername = getProxyReviewerUsername()
    if (!proxyUsername) {
      context.log.error(
        'PROXY_REVIEWER_USERNAME not configured, skipping reviewer assignment'
      )
      return
    }

    // Check if proxy user is already a requested reviewer
    const isProxyAlreadyRequested = pr.requested_reviewers?.some(
      (reviewer: { login: string; type: string }) =>
        reviewer.login === proxyUsername
    )

    if (isProxyAlreadyRequested) {
      context.log.info(
        `Proxy user is already a requested reviewer for PR #${pr.number}`
      )
      return
    }

    // Add proxy user as reviewer
    await context.octokit.pulls.requestReviewers({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: pr.number,
      reviewers: [proxyUsername]
    })

    context.log.info(
      `Successfully added proxy user as reviewer for PR #${pr.number}`
    )
  } catch (error) {
    // Enhanced error logging
    context.log.error(`Error adding bot as reviewer: ${error}`)
    context.log.error(`Error details:`, {
      message: error.message,
      status: error.status,
      response: error.response?.data,
      stack: error.stack
    })
    // Don't throw error to avoid breaking the workflow
  }
}

/**
 * Gets the bot's username from the GitHub App
 * Caches the result to avoid repeated API calls
 */
export async function getBotUsername(context: Context): Promise<string> {
  // Return cached value if available
  if (cachedBotUsername) {
    return cachedBotUsername
  }

  try {
    const app = await context.octokit.apps.getAuthenticated()
    const username = `${app.data.slug}[bot]`

    // Cache the successful result
    cachedBotUsername = username
    return username
  } catch (error) {
    context.log.error(`Failed to get bot username: ${error}`)
    // Re-throw the original error to avoid nested error messages
    throw error
  }
}
