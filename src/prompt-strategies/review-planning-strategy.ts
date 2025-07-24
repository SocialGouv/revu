import { getCodingGuidelines } from '../config-handler.ts'
import type { PlatformContext } from '../core/models/platform-types.ts'
import { cleanUpRepository, fetchRelatedIssues } from '../repo-utils.ts'
import { guidedExecutionPhase } from './execution/guided-execution-phase.ts'
import { planReview } from './planning/plan-review.ts'
import { prepareRepositoryForReview } from './prepare-repository-for-review.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Review planning prompt generation strategy using Tree-of-Thoughts techniques.
 *
 * This strategy implements a 2-step process:
 * 1. Planning Phase: Internal analysis to detect issues and create a structured plan
 * 2. Execution Phase: Generates user-facing comments presenting findings as fresh analysis
 *
 * The planning phase output is internal only - the execution phase presents its findings
 * as if conducting fresh analysis to avoid referencing information the user cannot see.
 *
 * @param repositoryUrl - The URL of the repository
 * @param branch - The branch to analyze
 * @param context - Platform-agnostic context including PR information and client
 * @param templatePath - Optional path to a custom template file (not used in this strategy)
 * @returns A promise that resolves to the generated structured review response
 */
export const reviewPlanningPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  context: PlatformContext,
  _templatePath?: string
): Promise<string> => {
  // Setup repository and extract PR data using shared utility
  const { repoPath, diff, modifiedFilesContent } =
    await prepareRepositoryForReview(repositoryUrl, branch, context)

  try {
    // Get coding guidelines from configuration
    let codingGuidelines = ''
    try {
      codingGuidelines = await getCodingGuidelines(repoPath)
    } catch (error) {
      console.warn(`Failed to load coding guidelines: ${error.message}`)
    }

    // Fetch related issues using platform client
    const relatedIssues = await fetchRelatedIssues(context)

    // Prepare common data for both phases
    const commonData = {
      repositoryUrl,
      repoPath,
      diff,
      modifiedFilesContent,
      codingGuidelines,
      relatedIssues,
      context
    }

    console.log('Starting review planning phase...')

    // Step 1: Review Planning Phase (Tree-of-Thoughts)
    const reviewPlan = await planReview(commonData)

    console.log('Planning phase completed, starting guided execution phase...')

    // Step 2: Guided Execution Phase
    return await guidedExecutionPhase(commonData, reviewPlan)
  } finally {
    // Clean up repository
    await cleanUpRepository(repoPath)
  }
}
