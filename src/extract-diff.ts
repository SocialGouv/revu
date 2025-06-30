import { type Context } from 'probot'

interface DiffInfo {
  changedLines: Set<number> // Set of line numbers that were changed in the diff
}

/**
 * Fetches the diff for a PR using the GitHub API
 * @param context GitHub API context
 * @param prNumber PR number
 * @returns The diff as a string
 */
async function fetchPrDiff(
  context: Context,
  prNumber: number
): Promise<string> {
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

  return response.data as unknown as string
}

/**
 * Fetches the diff for a PR and parses it to identify changed lines
 * @param context GitHub API context
 * @param prNumber PR number
 * @returns Map of file paths to their diff information
 */
export async function fetchPrDiffFileMap(
  context: Context,
  prNumber: number
): Promise<Map<string, DiffInfo>> {
  // The response will be a string when using the diff media type
  const diffText = await fetchPrDiff(context, prNumber)

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
