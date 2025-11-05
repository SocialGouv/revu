import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import type { PlatformContext } from '../core/models/platform-types.ts'
import type { PromptStrategy } from './prompt-strategy.ts'
import { buildReviewContext } from './build-review-context.ts'

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
  const reviewCtx = await buildReviewContext(repositoryUrl, branch, context)

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

  // Get coding guidelines from shared review context
  const codingGuidelines = reviewCtx.codingGuidelines

  // Related issues from shared review context
  const relatedIssues = reviewCtx.relatedIssues

  // Populate the template with the data

  return template({
    pr_title: reviewCtx.prTitle || context?.prTitle,
    pr_body: reviewCtx.prBody ?? null,
    pr_git_diff: reviewCtx.diff,
    modified_files: reviewCtx.modifiedFilesContent,
    coding_guidelines: codingGuidelines,
    related_issues: relatedIssues
  })
}
