import { extractCodebaseFromRepo } from './extract-codebase.ts'
import { extractDiffFromRepo } from './extract-diff.ts'
import { extractLogFromRepo } from './extract-log.ts'
import { prepareRepository, cleanUpRepository } from './repo-utils'
import * as os from 'os'
import * as path from 'path'

interface ExtractAllOptions {
  branch: string
  repoPath: string
}

interface ExtractAllFromUrlOptions {
  repositoryUrl: string
  branch: string
  tempFolder?: string
  token?: string
}

interface ExtractAllResult {
  codebase: string
  diff: string
  log: string
}

/**
 * Extracts all necessary data from a GitHub repository for PR analysis.
 * This function coordinates the extraction of codebase, diff, and log data by:
 * 1. Creating a temporary directory
 * 2. Cloning the repository with all branches
 * 3. Concurrently extracting codebase, diff, and log information
 * 4. Cleaning up temporary files after extraction
 *
 * @param {Object} options - The options for extraction
 * @param {string} options.branch - The branch name to analyze
 * @param {string} options.repoPath - The path to the locally cloned repo
 * @returns {Promise<{codebase: string, diff: string, log: string}>} Object containing extracted data
 * @throws {Error} If any extraction step fails
 */
export async function extractAll({
  branch,
  repoPath
}: ExtractAllOptions): Promise<ExtractAllResult> {
  // Extract all information concurrently using the same directory
  const [codebase, diff, log] = await Promise.all([
    extractCodebaseFromRepo({
      repoPath: repoPath
    }),
    extractDiffFromRepo({
      branch,
      repoPath: repoPath
    }),
    extractLogFromRepo({
      branch,
      repoPath: repoPath
    })
  ])

  return {
    codebase,
    diff,
    log
  }
}

/**
 * Extracts all necessary data from a GitHub repository URL for PR analysis.
 * This function:
 * 1. Creates a temporary directory
 * 2. Clones the repository with authentication if provided
 * 3. Concurrently extracts codebase, diff, and log information
 * 4. Cleans up temporary files after extraction
 *
 * @param {Object} options - The options for extraction
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch name to analyze
 * @param {string} [options.tempFolder] - Optional temporary folder path for cloning
 * @param {string} [options.token] - Optional GitHub access token for private repos
 * @returns {Promise<{codebase: string, diff: string, log: string}>} Object containing extracted data
 * @throws {Error} If any extraction step fails
 */
export async function extractAllFromUrl({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'revu-all-' + Date.now()),
  token
}: ExtractAllFromUrlOptions): Promise<ExtractAllResult> {
  let repoPath = ''

  try {
    // Prepare the repository (clone with authentication if token provided)
    repoPath = await prepareRepository(repositoryUrl, branch, tempFolder, token)

    // Extract all information using the cloned repository
    const result = await extractAll({
      branch,
      repoPath
    })

    // Clean up the temporary repository
    await cleanUpRepository(repoPath)

    return result
  } catch (error) {
    // Clean up on error if repoPath was set
    if (repoPath) {
      await cleanUpRepository(repoPath)
    }

    throw error
  }
}
