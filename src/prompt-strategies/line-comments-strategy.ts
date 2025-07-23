import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { getCodingGuidelines } from '../config-handler.ts'
import type { PlatformContext } from '../core/models/platform-types.ts'
import { cleanUpRepository, fetchRelatedIssues } from '../repo-utils.ts'
import { prepareRepositoryForReview } from './prepare-repository-for-review.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

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
  // Setup repository and extract PR data using shared utility
  const { repoPath, diff, modifiedFilesContent } =
    await prepareRepositoryForReview(repositoryUrl, branch, context)

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
    pr_git_diff: diff,
    modified_files: modifiedFilesContent,
    coding_guidelines: codingGuidelines,
    related_issues: relatedIssues
  })

  return result
}
