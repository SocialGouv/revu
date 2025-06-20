import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { getCodingGuidelines } from '../config-handler.ts'
import { extractDiffFromRepo } from '../extract-diff.ts'
import {
  extractModifiedFilePaths,
  filterIgnoredFiles,
  getFilesContent
} from '../file-utils.ts'
import { createGithubAppOctokit } from '../github/utils.ts'
import {
  cleanUpRepository,
  extractIssueNumbers,
  fetchIssueDetails,
  prepareRepository,
  type IssueDetails
} from '../repo-utils.ts'
import type { PromptContext, PromptStrategy } from './prompt-strategy.ts'

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
 * @param context - Optional additional context including PR information
 * @returns A promise that resolves to the generated prompt string
 */
export const lineCommentsPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  templatePath?: string,
  githubAccessToken?: string,
  context?: PromptContext
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

  // Filter out ignored files
  const filteredFiles = await filterIgnoredFiles(modifiedFiles, repoPath)

  // Get content of modified files - use repoPath where the files actually are
  const modifiedFilesContent = await getFilesContent(filteredFiles, repoPath)

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

  // Get coding guidelines from configuration
  let codingGuidelines = ''
  try {
    codingGuidelines = await getCodingGuidelines(repoPath)
  } catch (error) {
    console.warn(`Failed to load coding guidelines: ${error.message}`)
  }

  // Fetch related issues if PR context is provided
  const relatedIssues: IssueDetails[] = []
  if (context?.prBody && context?.repoOwner && context?.repoName) {
    try {
      const issueNumbers = extractIssueNumbers(context.prBody)
      if (issueNumbers.length > 0) {
        console.log(`Found related issues: ${issueNumbers.join(', ')}`)

        const octokit = await createGithubAppOctokit(
          context.repoOwner,
          context.repoName
        )

        for (const issueNumber of issueNumbers) {
          const issueDetails = await fetchIssueDetails(
            octokit,
            context.repoOwner,
            context.repoName,
            issueNumber
          )

          if (issueDetails) {
            relatedIssues.push(issueDetails)
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch related issues: ${error}`)
    }
  }

  // Populate the template with the data
  const result = template({
    absolute_code_path: absolutePath,
    git_diff_branch: diff,
    modified_files: modifiedFilesContent,
    coding_guidelines: codingGuidelines,
    related_issues: relatedIssues
  })

  return result
}
