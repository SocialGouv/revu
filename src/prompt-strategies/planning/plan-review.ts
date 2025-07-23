import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { reviewPlanningSender } from '../../anthropic-senders/planning-sender.ts'
import type {
  IssueDetails,
  PlatformContext
} from '../../core/models/platform-types.ts'

// Type definitions for the planning phase
export interface CodeReviewIssue {
  id: string
  file_path: string
  line?: number
  issue_type:
    | 'security'
    | 'performance'
    | 'bug'
    | 'maintainability'
    | 'style'
    | 'testing'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  context: string // Relevant code snippet + surrounding context
  suggested_fix: string // Single, clear fix description
  code_suggestion?: string // Optional improved code example
}

export interface ReviewPlan {
  issues: CodeReviewIssue[]
}

export interface CommonData {
  repositoryUrl: string
  repoPath: string
  diff: string
  modifiedFilesContent: Record<string, string>
  codingGuidelines: string
  relatedIssues: IssueDetails[]
  context: PlatformContext
}

/**
 * Planning Phase for issue detection and analysis.
 *
 * This phase focuses on:
 * 1. Detecting concrete issues in the PR code
 * 2. Providing essential context and fix suggestions for each issue
 *
 * @param commonData - Shared data between planning and execution phases
 * @returns A review plan with detected issues
 */
export async function planReview(commonData: CommonData): Promise<ReviewPlan> {
  const {
    repositoryUrl,
    diff,
    modifiedFilesContent,
    codingGuidelines,
    relatedIssues,
    context
  } = commonData

  // Read and compile the planning template
  const templatePath = path.join(
    process.cwd(),
    'templates',
    'planning-prompt.hbs'
  )

  const templateContent = await fs.readFile(templatePath, 'utf-8')
  let template
  try {
    template = Handlebars.compile(templateContent)
  } catch (error) {
    throw new Error(`Failed to compile planning template: ${error.message}`)
  }

  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''
  const absolutePath = path.join(process.cwd(), repoName)

  // Populate the planning template with data
  const planningPrompt = template({
    absolute_code_path: absolutePath,
    pr_title: context?.prTitle,
    pr_body: context?.prBody?.length > 16 ? context.prBody : null,
    pr_git_diff: diff,
    modified_files: modifiedFilesContent,
    coding_guidelines: codingGuidelines,
    related_issues: relatedIssues,
    modified_file_paths: Object.keys(modifiedFilesContent)
  })

  // Send to Anthropic for planning
  const planningResponse = await reviewPlanningSender(planningPrompt)

  // Parse the planning response
  let reviewPlan: ReviewPlan
  try {
    reviewPlan = JSON.parse(planningResponse)
  } catch (error) {
    throw new Error(
      `Failed to parse review planning response: ${error.message}`
    )
  }

  // Validate the planning response structure
  if (!reviewPlan.issues || !Array.isArray(reviewPlan.issues)) {
    throw new Error(
      'Invalid review planning response: missing or invalid issues array'
    )
  }

  console.log(
    `Review plan generated with ${reviewPlan.issues.length} detected issues`
  )

  return reviewPlan
}
