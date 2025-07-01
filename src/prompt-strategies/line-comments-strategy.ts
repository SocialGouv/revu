import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as os from 'os'
import * as path from 'path'
import { getCodingGuidelines } from '../config-handler.ts'
import type {
  IssueDetails,
  PlatformContext
} from '../core/models/platform-types.ts'
import {
  extractModifiedFilePaths,
  filterIgnoredFiles,
  getFilesContent
} from '../file-utils.ts'
import { cleanUpRepository, extractIssueNumbers } from '../repo-utils.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Fetches related issues using the platform client
 * @param context - Platform context containing client and PR information
 * @returns Array of issue details
 */
const fetchRelatedIssues = async (
  context?: PlatformContext
): Promise<IssueDetails[]> => {
  if (!context?.prBody || !context?.client) return []

  const issueNumbers = extractIssueNumbers(context.prBody)
  if (issueNumbers.length === 0) return []

  console.log(`Found related issues: ${issueNumbers.join(', ')}`)

  const issuePromises = issueNumbers.map((num) =>
    context.client.fetchIssueDetails(num)
  )
  const issues = await Promise.all(issuePromises)

  return issues.filter((issue): issue is IssueDetails => issue !== null)
}

/**
 * Line comments prompt generation strategy.
 * Requests line-specific comments.
 * Instructs Claude to respond with a structured JSON format that includes:
 * - A summary of the PR
 * - Individual comments for specific lines of code
 *
 * @param repositoryUrl - The URL of the repository
 * @param branch - The branch to analyze
 * @param context - Platform-agnostic context including PR information and client
 * @param templatePath - Optional path to a custom template file
 * @returns A promise that resolves to the generated prompt string
 */
export const lineCommentsPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  context: PlatformContext,
  templatePath?: string
): Promise<string> => {
  // Fetch PR diff using platform client
  if (!context.prNumber || !context.client) {
    throw new Error('Platform context with PR number and client is required')
  }

  // Prepare the repository for extraction using platform client
  const tempFolder = path.join(os.tmpdir(), 'revu-all-' + Date.now())

  try {
    await fs.rm(tempFolder, { recursive: true, force: true })
  } catch {
    // Ignore errors if folder doesn't exist
  }
  await fs.mkdir(tempFolder, { recursive: true })

  // Clone repository using platform client
  await context.client.cloneRepository(repositoryUrl, branch, tempFolder)

  const repoPath = tempFolder

  const diff = await context.client.fetchPullRequestDiff(context.prNumber)

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
  let template
  try {
    template = Handlebars.compile(templateContent)
  } catch (error) {
    throw new Error(`Failed to compile Handlebars template: ${error.message}`)
  }

  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''
  const absolutePath = path.join(process.cwd(), repoName)

  // Get coding guidelines from configuration
  let codingGuidelines = ''
  try {
    codingGuidelines = await getCodingGuidelines(repoPath)
  } catch (error) {
    console.warn(`Failed to load coding guidelines: ${error.message}`)
  }

  // Fetch related issues using platform client
  const relatedIssues = await fetchRelatedIssues(context)

  // Populate the template with the data
  const result = template({
    absolute_code_path: absolutePath,
    pr_title: context?.prTitle,
    pr_body: context?.prBody?.length > 16 ? context.prBody : null,
    git_diff_branch: diff,
    modified_files: modifiedFilesContent,
    coding_guidelines: codingGuidelines,
    related_issues: relatedIssues
  })

  return result
}
