import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { cloneRepository } from './repo-utils'

const execAsync = promisify(exec)

interface ExtractLogOptions {
  repositoryUrl: string
  branch: string
  tempFolder?: string
  token?: string
}

interface ExtractLogFromRepoOptions {
  branch: string
  repoPath: string
}

/**
 * Extracts git commit log from an already cloned repository.
 * Retrieves formatted commit history for the specified branch.
 *
 * @param {Object} options - The options for log extraction
 * @param {string} options.branch - The branch to get logs from
 * @param {string} options.repoPath - Path to the cloned repository
 * @returns {Promise<string>} Formatted git log output
 * @throws {Error} If log extraction fails
 */
export async function extractLogFromRepo({
  branch,
  repoPath
}: ExtractLogFromRepoOptions): Promise<string> {
  // Generate and return the git log for the specified branch
  const { stdout } = await execAsync(
    `git log origin/${branch} --pretty=format:"%h - %an, %ar : %s"`,
    {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large logs
    }
  )

  return stdout
}

// Keep original function for backward compatibility
/**
 * Legacy function that extracts git commit log from a GitHub repository.
 * Creates a temporary clone of the repository and delegates to extractLogFromRepo.
 *
 * @param {Object} options - The options for log extraction
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch to get logs from
 * @param {string} [options.tempFolder] - Optional temporary folder path for cloning
 * @param {string} [options.token] - Optional access token for authentication with private repos
 * @returns {Promise<string>} Formatted git log output
 * @throws {Error} If cloning or log extraction fails
 * @deprecated Use extractLogFromRepo when repository is already cloned
 */
export async function extractLog({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'revu-log-' + Date.now()),
  token
}: ExtractLogOptions): Promise<string> {
  try {
    // Create temporary directory
    await fs.mkdir(tempFolder, { recursive: true })

    // Clone the repository with the centralized function
    await cloneRepository({
      repositoryUrl,
      destination: tempFolder,
      token
    })

    // Fetch all branches
    await execAsync('git fetch --all', { cwd: tempFolder })

    // Extract log using the new function
    const log = await extractLogFromRepo({
      branch,
      repoPath: tempFolder
    })

    // Clean up
    await fs.rm(tempFolder, { recursive: true, force: true })

    return log
  } catch (error) {
    // Clean up on error
    try {
      await fs.rm(tempFolder, { recursive: true, force: true })
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError)
    }

    throw error
  }
}
