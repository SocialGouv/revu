import { exec } from 'child_process'
import { type Context } from 'probot'
import { promisify } from 'util'

const execAsync = promisify(exec)

interface ExtractDiffFromRepoOptions {
  branch: string
  repoPath: string
}

interface DiffInfo {
  changedLines: Set<number> // Set of line numbers that were changed in the diff
}

/**
 * Attempts to determine the default branch of a repository.
 * First tries to get it from the remote HEAD reference, then falls back to checking common names.
 *
 * @param {string} repoPath - Path to the cloned repository
 * @returns {Promise<string>} The name of the default branch
 * @throws {Error} If the default branch cannot be determined
 * @private
 */
async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    // Try to get the default branch from the remote
    const { stdout } = await execAsync(
      'git symbolic-ref refs/remotes/origin/HEAD',
      { cwd: repoPath }
    )
    return stdout.trim().replace('refs/remotes/origin/', '')
  } catch {
    // If that fails, try common default branch names
    for (const branch of ['main', 'master', 'dev']) {
      try {
        await execAsync(`git show-ref --verify refs/remotes/origin/${branch}`, {
          cwd: repoPath
        })
        return branch
      } catch {
        continue
      }
    }
    throw new Error('Could not determine default branch')
  }
}

/**
 * Extracts git diff from an already cloned repository.
 * Compares the specified branch against the repository's default branch.
 *
 * @param {Object} options - The options for diff extraction
 * @param {string} options.branch - The branch to compare
 * @param {string} options.repoPath - Path to the cloned repository
 * @returns {Promise<string>} The git diff output
 * @throws {Error} If diff generation fails
 */
export async function extractDiffFromRepo({
  branch,
  repoPath
}: ExtractDiffFromRepoOptions): Promise<string> {
  // Get the default branch name
  const defaultBranch = await getDefaultBranch(repoPath)

  // Generate and return the diff between the default branch and the specified branch
  const { stdout } = await execAsync(
    `git diff origin/${defaultBranch}...origin/${branch}`,
    {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large diffs
    }
  )

  return stdout
}

/**
 * Fetches the diff for a PR and parses it to identify changed lines
 * @param context GitHub API context
 * @param prNumber PR number
 * @returns Map of file paths to their diff information
 */
export async function fetchPrDiff(
  context: Context,
  prNumber: number
): Promise<Map<string, DiffInfo>> {
  const repo = context.repo()

  // Fetch the PR diff with the 'application/vnd.github.v3.diff' media type
  const response = await context.octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    {
      ...repo,
      pull_number: prNumber,
      headers: {
        accept: 'application/vnd.github.v3.diff'
      }
    }
  )

  // The response will be a string when using the diff media type
  const diffText = response.data as unknown as string

  // Parse the diff to extract changed lines
  return parseDiff(diffText)
}

/**
 * Parses a git diff to extract changed lines and their hunks
 * @param diff Git diff string
 * @returns Map of file paths to their diff information
 */
function parseDiff(diff: string): Map<string, DiffInfo> {
  const fileMap = new Map<string, DiffInfo>()

  // Split the diff into file sections
  const fileSections = diff.split('diff --git ')

  for (let i = 1; i < fileSections.length; i++) {
    const section = fileSections[i]

    // Extract file path
    const filePathMatch = section.match(/a\/(.+?) b\//)
    if (!filePathMatch) continue

    const filePath = filePathMatch[1]
    const changedLines = new Set<number>()

    // Extract hunks
    const hunks = section.split('\n@@').slice(1)

    for (const hunk of hunks) {
      // Extract hunk header
      const hunkHeaderMatch = hunk.match(/^[ -+](-\d+,\d+ \+\d+,\d+) @@/)
      if (!hunkHeaderMatch) continue

      // Split hunk into lines
      const lines = hunk.split('\n')
      let lineNumber = parseInt(
        hunkHeaderMatch[1].match(/\+(\d+)/)?.[1] || '0',
        10
      )

      // Process each line in the hunk
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j]

        // Skip removed lines (they don't exist in the new file)
        if (line.startsWith('-')) continue

        // For added lines, track the line number
        if (line.startsWith('+')) {
          // This is an added/modified line
          changedLines.add(lineNumber)
        }

        // Increment line number for context and added lines
        if (line.startsWith('+') || !line.startsWith('-')) {
          lineNumber++
        }
      }
    }

    fileMap.set(filePath, { changedLines })
  }

  return fileMap
}
