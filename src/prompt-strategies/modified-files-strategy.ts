import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { getCodingGuidelines } from '../config-handler.ts'
import { extractDiffFromRepo } from '../extract-diff.ts'
import {
  extractModifiedFilePaths,
  getFilesContent,
  filterIgnoredFiles
} from '../file-utils.ts'
import { cleanUpRepository, prepareRepository } from '../repo-utils.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Modified files prompt generation strategy.
 * Only includes content of files being modified in the PR diff.
 * This strategy extracts the repository data and focuses on modified files.
 *
 * @param repositoryUrl - The URL of the GitHub repository
 * @param branch - The branch to analyze
 * @param templatePath - Optional path to a custom template file
 * @param token - Optional GitHub access token for private repositories
 * @returns A promise that resolves to the generated prompt string
 */
export const modifiedFilesPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  templatePath?: string,
  token?: string
): Promise<string> => {
  // Prepare the repository for extraction with authentication if needed
  const repoPath = await prepareRepository(
    repositoryUrl,
    branch,
    undefined,
    token
  )
  const diff = await extractDiffFromRepo({
    branch,
    repoPath
  })

  // Extract repository name from URL (keeping for clarity)
  // const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''

  // Extract modified file paths from the diff (excluding deleted files)
  const modifiedFiles = extractModifiedFilePaths(diff)

  // Filter out ignored files
  const filteredFiles = await filterIgnoredFiles(modifiedFiles, repoPath)

  // Get content of modified files - use repoPath where the files actually are
  const modifiedFilesContent = await getFilesContent(filteredFiles, repoPath)

  await cleanUpRepository(repoPath)

  // Read and compile the template
  const defaultTemplatePath = path.join(
    process.cwd(),
    'templates',
    'modified-files-prompt.hbs'
  )
  const actualTemplatePath = templatePath || defaultTemplatePath
  const templateContent = await fs.readFile(actualTemplatePath, 'utf-8')
  const template = Handlebars.compile(templateContent)

  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''
  const localRepoPath = path.join(process.cwd(), repoName)

  // Get coding guidelines from configuration
  const codingGuidelines = await getCodingGuidelines(repoPath)

  // Populate the template with the data
  const result = template({
    local_repo_path: localRepoPath, // Use the actual repository path where files are located
    git_diff_branch: diff,
    modified_files: modifiedFilesContent,
    coding_guidelines: codingGuidelines
  })

  return result
}
