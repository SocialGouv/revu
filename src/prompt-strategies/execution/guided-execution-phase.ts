import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { guidedExecutionSender } from '../../anthropic-senders/guided-execution-sender.ts'
import type { CommonData, ReviewPlan } from '../planning/plan-review.ts'

/**
 * Guided Execution Phase that generates targeted comments from identified issues.
 *
 * This phase takes the review plan with detected issues and generates specific,
 * high-quality code review comments. It presents the analysis as fresh findings
 * rather than referencing a previous planning phase, ensuring the user sees
 * coherent comments without missing context.
 *
 * @param commonData - Shared data between planning and execution phases (minimal usage)
 * @param reviewPlan - The plan with detected issues
 * @returns A stringified JSON response containing structured review comments
 */
export async function guidedExecutionPhase(
  commonData: CommonData,
  reviewPlan: ReviewPlan
): Promise<string> {
  const { context } = commonData

  // Read and compile the execution template
  const templatePath = path.join(
    process.cwd(),
    'templates',
    'guided-execution-prompt.hbs'
  )

  const templateContent = await fs.readFile(templatePath, 'utf-8')
  let template
  try {
    template = Handlebars.compile(templateContent)
  } catch (error) {
    throw new Error(
      `Failed to compile guided execution template: ${error.message}`
    )
  }

  // Populate the execution template with issues from the review plan
  const executionPrompt = template({
    pr_title: context?.prTitle,
    pr_body: context?.prBody?.length > 16 ? context.prBody : null,
    issues: reviewPlan.issues,
    // Helper data derived from the issues
    critical_issues: reviewPlan.issues.filter(
      (issue) => issue.severity === 'critical'
    ),
    high_priority_issues: reviewPlan.issues.filter(
      (issue) => issue.severity === 'high'
    ),
    security_issues: reviewPlan.issues.filter(
      (issue) => issue.issue_type === 'security'
    ),
    performance_issues: reviewPlan.issues.filter(
      (issue) => issue.issue_type === 'performance'
    )
  })

  // Send to Anthropic for guided execution
  const executionResponse = await guidedExecutionSender(executionPrompt)

  console.log('Guided execution phase completed')

  return executionResponse
}
