import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { extractCodebaseFromRepo } from './extract-codebase.ts'
import { extractDiffFromRepo } from './extract-diff.ts'
import { extractLogFromRepo } from './extract-log.ts'

const execAsync = promisify(exec)

interface ExtractAllOptions {
  repositoryUrl: string
  branch: string
  tempFolder?: string
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
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch name to analyze
 * @param {string} [options.tempFolder] - Optional temporary folder path for cloning
 * @returns {Promise<{codebase: string, diff: string, log: string}>} Object containing extracted data
 * @throws {Error} If any extraction step fails
 */
export async function extractAll({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'revu-all-' + Date.now())
}: ExtractAllOptions): Promise<ExtractAllResult> {
  try {
    // Create temporary directory
    await fs.mkdir(tempFolder, { recursive: true })

    // Clone the repository with all branches
    await execAsync(`git clone ${repositoryUrl} ${tempFolder}`)

    // Fetch all branches
    await execAsync('git fetch --all', { cwd: tempFolder })

    // Extract all information concurrently using the same directory
    const [codebase, diff, log] = await Promise.all([
      extractCodebaseFromRepo({
        branch,
        repoPath: tempFolder
      }),
      extractDiffFromRepo({
        branch,
        repoPath: tempFolder
      }),
      extractLogFromRepo({
        branch,
        repoPath: tempFolder
      })
    ])

    return {
      codebase,
      diff,
      log
    }
  } finally {
    // Clean up
    try {
      await fs.rm(tempFolder, { recursive: true, force: true })
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError)
    }
  }
}
