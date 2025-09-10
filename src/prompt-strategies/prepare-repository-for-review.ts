import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type { PlatformContext } from '../core/models/platform-types.ts'
import {
  extractModifiedFilePaths,
  filterIgnoredFiles,
  filterDiffToReviewableFiles,
  getFilesContent
} from '../file-utils.ts'

interface RepositorySetupResult {
  repoPath: string
  diff: string
  modifiedFiles: string[]
  filteredFiles: string[]
  modifiedFilesContent: Record<string, string>
  pr: { head: { sha: string } }
  commitSha: string
}

/**
 * Sets up a temporary repository clone and extracts PR data.
 * This function handles the common repository preparation logic used by multiple prompt strategies.
 *
 * @param repositoryUrl - The URL of the repository to clone
 * @param branch - The branch to analyze
 * @param context - Platform context with PR number and client
 * @returns Promise resolving to repository setup data
 */
export async function prepareRepositoryForReview(
  repositoryUrl: string,
  branch: string,
  context: PlatformContext
): Promise<RepositorySetupResult> {
  // Validate required context
  if (!context.prNumber || !context.client) {
    throw new Error('Platform context with PR number and client is required')
  }

  // Prepare the repository for extraction using platform client
  const tempFolder = path.join(
    os.tmpdir(),
    `revu-repos-${context.prNumber}-` + Date.now()
  )

  try {
    await fs.rm(tempFolder, { recursive: true, force: true })
  } catch {
    // Ignore errors if folder doesn't exist
  }
  await fs.mkdir(tempFolder, { recursive: true })

  // Clone repository using platform client
  await context.client.cloneRepository(repositoryUrl, branch, tempFolder)

  const repoPath = tempFolder

  // Extract PR data
  const diff = await context.client.fetchPullRequestDiff(context.prNumber)
  const modifiedFiles = extractModifiedFilePaths(diff)

  // Get PR details for commit SHA
  const pr = await context.client.getPullRequest(context.prNumber)
  const commitSha = pr.head.sha

  // Filter out ignored files using remote .revuignore
  const filteredFiles = await filterIgnoredFiles(
    modifiedFiles,
    context.client,
    commitSha
  )

  // Filter diff content to only include reviewable files - this ensures
  // consistency between the diff sent to Claude and the file content
  const diffLines = diff.split('\n')
  const filteredDiffLines = filterDiffToReviewableFiles(
    diffLines,
    filteredFiles
  )
  const filteredDiff = filteredDiffLines.join('\n')

  // Get content of modified files
  const modifiedFilesContent = await getFilesContent(filteredFiles, repoPath)

  return {
    repoPath,
    diff: filteredDiff,
    modifiedFiles,
    filteredFiles,
    modifiedFilesContent,
    pr,
    commitSha
  }
}
