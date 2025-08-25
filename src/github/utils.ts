import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { logSystemError } from '../utils/logger.ts'

/**
 * GitHub App Utilities
 *
 * This module provides utilities for creating GitHub App authenticated Octokit instances.
 * These are necessary for:
 * 1. CLI operations that don't have a Probot context
 * 2. Installation-level authentication for private repositories
 * 3. App-level operations like getting installation IDs
 *
 * NOTE: When working within Probot event handlers, prefer using context.octokit
 * from the provided context instead of creating new instances.
 */

/**
 * Fetches GitHub App credentials from environment variables
 */
function fetchGitHubCredentials(): {
  appId: string
  privateKey: string
} {
  const appId = process.env.APP_ID
  const privateKey = process.env.PRIVATE_KEY

  if (!appId || !privateKey) {
    throw new Error(
      'GitHub App credentials (APP_ID and PRIVATE_KEY) are required'
    )
  }

  return { appId, privateKey }
}

/**
 * Creates an Octokit instance with GitHub App authentication (app-level)
 * @returns Octokit instance with app-level authentication
 */
function createAppOctokit(): Octokit {
  const { appId, privateKey } = fetchGitHubCredentials()

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      type: 'app'
    }
  })
}

/**
 * Gets the installation ID for a repository
 * @param owner Repository owner
 * @param repo Repository name
 * @returns Installation ID
 */
async function getInstallationId(owner: string, repo: string): Promise<number> {
  const appOctokit = createAppOctokit()

  try {
    const { data: installation } = await appOctokit.request(
      'GET /repos/{owner}/{repo}/installation',
      {
        owner,
        repo
      }
    )

    return installation.id
  } catch (error) {
    logSystemError(error, {
      repository: `${owner}/${repo}`,
      context_msg: `Failed to get installation ID for ${owner}/${repo}`
    })
    throw error
  }
}

/**
 * Generates an installation token for a repository
 * @param owner Repository owner
 * @param repo Repository name
 * @returns Installation token
 */
export async function generateInstallationToken(
  owner: string,
  repo: string
): Promise<string> {
  const { appId, privateKey } = fetchGitHubCredentials()
  const installationId = await getInstallationId(owner, repo)

  const auth = createAppAuth({
    appId,
    privateKey,
    installationId
  })

  const { token } = await auth({ type: 'installation' })
  return token
}

/**
 * Creates an Octokit instance with GitHub App installation authentication
 * @param owner Repository owner
 * @param repo Repository name
 * @returns Octokit instance with installation-level authentication
 */
export async function createGithubAppOctokit(
  owner: string,
  repo: string
): Promise<Octokit> {
  const { appId, privateKey } = fetchGitHubCredentials()

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      type: 'app'
    }
  })

  const { data } = await appOctokit.request(
    'GET /repos/{owner}/{repo}/installation',
    { owner, repo }
  )

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: data.id
    }
  })
}
