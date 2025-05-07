import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { extractDiffFromRepo } from '../extract-diff.ts'
import { cleanUpRepository, prepareRepository } from '../repo-utils.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Line comments prompt generation strategy.
 * Similar to the modified-files strategy but requests line-specific comments.
 * Instructs Claude to respond with a structured JSON format that includes:
 * - A summary of the PR
 * - Individual comments for specific lines of code
 *
 * @param repositoryUrl - The URL of the GitHub repository
 * @param branch - The branch to analyze
 * @param templatePath - Optional path to a custom template file
 * @param githubAccessToken - Optional GitHub access token for private repositories
 * @returns A promise that resolves to the generated prompt string
 */
export const lineCommentsPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  templatePath?: string,
  githubAccessToken?: string
): Promise<string> => {
  // Prepare the repository for extraction with authentication if needed
  const repoPath = await prepareRepository(
    repositoryUrl,
    branch,
    undefined,
    githubAccessToken
  )
  const diff = await extractDiffFromRepo({
    branch,
    repoPath
  })

  // Extract modified file paths from the diff
  const modifiedFiles = extractModifiedFilePaths(diff)

  // Get content of modified files - use repoPath where the files actually are
  const modifiedFilesContent = await getFilesContent(modifiedFiles, repoPath)

  await cleanUpRepository(repoPath)

  // Read and compile the template
  const defaultTemplatePath = path.join(
    process.cwd(),
    'templates',
    'line-comments-prompt.hbs'
  )
  const actualTemplatePath = templatePath || defaultTemplatePath
  const templateContent = await fs.readFile(actualTemplatePath, 'utf-8')
  const template = Handlebars.compile(templateContent)

  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''
  const absolutePath = path.join(process.cwd(), repoName)

  // Populate the template with the data
  const result = template({
    absolute_code_path: absolutePath,
    git_diff_branch: diff,
    modified_files: modifiedFilesContent
  })

  return result
}

/**
 * Extracts modified file paths from the git diff.
 *
 * @param diff - Git diff output
 * @returns Array of modified file paths
 */
function extractModifiedFilePaths(diff: string): string[] {
  const modifiedFiles = new Set<string>()

  // Regular expression to match file paths in diff
  const filePathRegex = /^diff --git a\/(.*?) b\/(.*?)$/gm
  let match

  while ((match = filePathRegex.exec(diff)) !== null) {
    // Use the 'b' path (new file path)
    modifiedFiles.add(match[2])
  }

  return Array.from(modifiedFiles)
}

/**
 * Gets content of modified files.
 *
 * @param filePaths - Array of file paths
 * @param repoPath - Absolute path to the repository
 * @returns Object mapping file paths to their content
 */
async function getFilesContent(
  filePaths: string[],
  repoPath: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(repoPath, filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      result[filePath] = content
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error)
      result[filePath] = `Error reading file: ${error}`
    }
  }

  return result
}
