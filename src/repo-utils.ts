import { exec } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import type { ProbotOctokit } from 'probot'
import { promisify } from 'util'
import type {
  IssueDetails,
  PlatformContext
} from './core/models/platform-types.ts'
import {
  createSanitizedError,
  sanitizeGitCommand
} from './utils/error-sanitizer.ts'
import { logSystemError } from './utils/logger.ts'

const execAsync = promisify(exec)

/**
 * Clone a repository with support for authentication tokens and branch specification
 *
 * @param {Object} options - Options for cloning
 * @param {string} options.repositoryUrl - The URL of the repository to clone
 * @param {string} [options.branch] - Optional branch to checkout directly
 * @param {string} options.destination - Destination path for the clone
 * @param {string} [options.token] - Optional access token for authentication
 * @returns {Promise<void>}
 */
export async function cloneRepository({
  repositoryUrl,
  branch,
  destination,
  token
}: {
  repositoryUrl: string
  branch?: string
  destination: string
  token?: string
}): Promise<void> {
  // Transform the URL with token if provided, use x-access-token to avoid showing the token in URL
  let authUrl = repositoryUrl
  if (token) {
    // Special format for GitHub authentication: https://x-access-token:<token>@github.com/...
    authUrl = repositoryUrl.replace(
      'https://',
      `https://x-access-token:${token}@`
    )
  }

  // Base options for cloning
  let cloneCommand = `git clone ${authUrl} ${destination}`

  // Add branch option if specified
  if (branch) {
    cloneCommand += ` --branch ${branch}`
  }

  try {
    await execAsync(cloneCommand)
  } catch (error) {
    // Sanitize the error to remove any tokens before re-throwing
    if (error instanceof Error) {
      throw createSanitizedError(error)
    }
    // For non-Error objects, create a sanitized error message
    const errorMessage = typeof error === 'string' ? error : String(error)
    throw new Error(`Git clone failed: ${sanitizeGitCommand(errorMessage)}`)
  }
}

/**
 * Prepares a repository for extraction by cloning it and fetching all branches.
 *
 * @param {string} repositoryUrl - The URL of the GitHub repository to clone
 * @param {string} branch - The branch to checkout
 * @param {string} tempFolder - The folder path where the repository will be cloned
 * @param {string} [token] - Optional access token for authentication with private repos
 * @returns {Promise<string>} Path to the prepared repository
 * @throws {Error} If cloning or fetching fails
 */
export async function prepareRepository(
  repositoryUrl: string,
  branch: string,
  tempFolder = path.join(os.tmpdir(), 'revu-all-' + Date.now()),
  token?: string
): Promise<string> {
  // Create temporary directory, deleting it first if it already exists
  try {
    await fs.rm(tempFolder, { recursive: true, force: true })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Ignore errors if folder doesn't exist
  }
  await fs.mkdir(tempFolder, { recursive: true })

  // Clone the repository with all branches
  await cloneRepository({
    repositoryUrl,
    destination: tempFolder,
    token
  })

  // Fetch all branches
  await execAsync('git fetch --all', { cwd: tempFolder })

  // Checkout the branch
  await execAsync(`git checkout ${branch}`, { cwd: tempFolder })

  return tempFolder
}

export async function cleanUpRepository(repoPath: string): Promise<void> {
  // Clean up
  try {
    await fs.rm(repoPath, { recursive: true, force: true })
  } catch (cleanupError) {
    logSystemError(cleanupError, { context_msg: 'Error during cleanup' })
  }
}

/**
 * Extracts issue numbers from PR description text
 * Looks for patterns like: #123, fixes #123, https://github.com/owner/repo/issues/123
 */
export function extractIssueNumbers(text: string): number[] {
  const issueNumbers: number[] = []

  // Common patterns for referencing issues in GitHub
  const patterns = [
    // Direct references: #123
    /#(\d+)/g,
    // GitHub URLs: https://github.com/owner/repo/issues/123
    /https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g
  ]

  patterns.forEach((pattern) => {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const issueNumber = parseInt(match[1], 10)
      if (!issueNumbers.includes(issueNumber)) {
        issueNumbers.push(issueNumber)
      }
    }
  })

  return issueNumbers.sort((a, b) => a - b)
}

/**
 * Fetches issue details including title, description, and comments
 */
export async function fetchIssueDetails(
  octokit: ProbotOctokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<IssueDetails | null> {
  try {
    // Fetch issue details
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber
    })

    // Fetch issue comments
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber
    })

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body
      }))
    }
  } catch (error) {
    logSystemError(error, {
      context_msg: `Error fetching issue #${issueNumber}`
    })
    return null
  }
}

/**
 * Fetches related issues using the platform client
 * @param context - Platform context containing client and PR information
 * @returns Array of issue details
 */
export async function fetchRelatedIssues(
  context?: PlatformContext
): Promise<IssueDetails[]> {
  if (!context?.prBody || !context?.client) return []

  const issueNumbers = extractIssueNumbers(context.prBody)
  if (issueNumbers.length === 0) return []

  console.log(`Found related issues: ${issueNumbers.join(', ')}`)

  const issuePromises = issueNumbers.map((num) =>
    context.client.fetchIssueDetails(num)
  )
  const issues = await Promise.all(issuePromises)

  return issues.filter((issue): issue is IssueDetails => issue !== null)
}
