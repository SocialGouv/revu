import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { getPrivateKey } from '@probot/get-private-key'
import { createPrivateKey } from 'node:crypto'
import { logSystemError } from '../utils/logger.ts'
import { attachOctokitRetry } from './retry-hook.ts'
import chalk from 'chalk'

const KEY_FORMAT_HELP =
  'Invalid GitHub App PRIVATE_KEY. Provide the .pem private key downloaded from your GitHub App. In .env, use \\n-escaped newlines or set PRIVATE_KEY_PATH to the .pem file.'

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
  let privateKey: string | null = null

  try {
    privateKey = getPrivateKey({ env: process.env })
  } catch {
    // Normalize library validation errors into a consistent, friendly message
    throw new Error(KEY_FORMAT_HELP)
  }

  if (!appId || !privateKey) {
    throw new Error(
      'GitHub App credentials (APP_ID and PRIVATE_KEY or PRIVATE_KEY_PATH) are required'
    )
  }

  // Detect unsupported OpenSSH key format early
  if (privateKey.includes('BEGIN OPENSSH PRIVATE KEY')) {
    throw new Error(KEY_FORMAT_HELP)
  }

  // Deterministic validation: ensure Node/OpenSSL can parse the provided key
  try {
    createPrivateKey(privateKey)
  } catch {
    throw new Error(KEY_FORMAT_HELP)
  }

  return { appId, privateKey }
}

/**
 * Creates an Octokit instance with GitHub App authentication (app-level)
 * @returns Octokit instance with app-level authentication
 */
function createAppOctokit(): Octokit {
  const { appId, privateKey } = fetchGitHubCredentials()

  const octo = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      type: 'app'
    }
  })
  return attachOctokitRetry(octo)
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
 * Generates an installation token for a repository, or returns undefined if generation fails
 * @param owner Repository owner
 * @param repo Repository name
 * @returns Installation token or undefined
 */
export async function generateOptionalInstallationToken(
  owner: string,
  repo: string
): Promise<string | undefined> {
  console.log(chalk.gray('⚡ Setting up authentication...'))

  let token: string | undefined
  try {
    token = await generateInstallationToken(owner, repo)
  } catch (error) {
    console.warn(
      chalk.yellow('⚠ Failed to generate installation token:'),
      error
    )
    // Continue without token if generation fails
  }
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

  const appOctokit = attachOctokitRetry(
    new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        type: 'app'
      }
    })
  )

  let installationId: number
  try {
    const resp = await appOctokit.request(
      'GET /repos/{owner}/{repo}/installation',
      { owner, repo }
    )
    installationId = resp.data.id
  } catch (error) {
    logSystemError(error, {
      repository: `${owner}/${repo}`,
      context_msg: `Failed to get installation ID for ${owner}/${repo}`
    })
    throw error
  }

  return attachOctokitRetry(
    new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId
      }
    })
  )
}
