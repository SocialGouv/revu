import { exec } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import { promisify } from 'util'

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
  // Transformer l'URL avec token si fourni, utiliser x-access-token au lieu de montrer le token dans l'URL
  let authUrl = repositoryUrl
  if (token) {
    // Format spécial pour l'authentification GitHub: https://x-access-token:<token>@github.com/...
    authUrl = repositoryUrl.replace(
      'https://',
      `https://x-access-token:${token}@`
    )
  }

  // Options de base pour cloner
  let cloneCommand = `git clone ${authUrl} ${destination}`

  // Ajouter l'option branch si spécifiée
  if (branch) {
    cloneCommand += ` --branch ${branch}`
  }

  await execAsync(cloneCommand)
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

  // Copy the .aidigestignore file to the repository
  await fs.copyFile('.aidigestignore', path.join(tempFolder, '.aidigestignore'))

  return tempFolder
}

export async function cleanUpRepository(repoPath: string): Promise<void> {
  // Clean up
  try {
    await fs.rm(repoPath, { recursive: true, force: true })
  } catch (cleanupError) {
    console.error('Error during cleanup:', cleanupError)
  }
}
