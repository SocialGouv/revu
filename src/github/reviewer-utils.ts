import { Context } from 'probot'

// Cache for bot username to avoid repeated API calls
let cachedBotUsername: string | null = null

/**
 * Resets the bot username cache (primarily for testing)
 */
export function resetBotUsernameCache(): void {
  cachedBotUsername = null
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
    event.action === 'requested' &&
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

    // Get the bot username dynamically
    const botUsername = await getBotUsername(context)
    context.log.info(`Bot username resolved to: ${botUsername}`)

    // Log current requested reviewers
    context.log.info(
      `Current requested reviewers count for PR #${pr.number}: ${pr.requested_reviewers?.length || 0}`
    )
    if (pr.requested_reviewers && pr.requested_reviewers.length > 0) {
      pr.requested_reviewers.forEach((reviewer, index) => {
        context.log.info(
          `  Reviewer ${index + 1}: ${reviewer.login} (${reviewer.type})`
        )
      })
    } else {
      context.log.info(`  No current requested reviewers`)
    }

    // Check if bot is already a requested reviewer
    const isBotAlreadyRequested = pr.requested_reviewers?.some(
      (reviewer: { login: string; type: string }) =>
        reviewer.login === botUsername
    )

    if (isBotAlreadyRequested) {
      context.log.info(
        `Bot is already a requested reviewer for PR #${pr.number}`
      )
      return
    }

    // Log the parameters before making the API call
    const requestParams = {
      owner: repo.owner,
      repo: repo.repo,
      pull_number: pr.number,
      reviewers: [botUsername]
    }
    context.log.info(
      `Making requestReviewers API call with params:`,
      requestParams
    )

    // Add bot as reviewer
    const response = await context.octokit.pulls.requestReviewers(requestParams)

    // Response logging with JSON content
    context.log.info(`API Response status: ${response.status}`)
    context.log.info(`Response data exists: ${!!response.data}`)

    if (response.data) {
      context.log.info(
        `Response data JSON: ${JSON.stringify(response.data, null, 2)}`
      )
      context.log.info(
        `Requested reviewers JSON: ${JSON.stringify(response.data.requested_reviewers, null, 2)}`
      )
    } else {
      context.log.info(`Response data is null/undefined`)
    }

    context.log.info(`Successfully added bot as reviewer for PR #${pr.number}`)
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
