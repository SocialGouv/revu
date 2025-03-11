import { extractCodebaseFromRepo } from './extract-codebase.ts'
import { extractDiffFromRepo } from './extract-diff.ts'
import { extractLogFromRepo } from './extract-log.ts'

interface ExtractAllOptions {
  branch: string
  repoPath: string
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
