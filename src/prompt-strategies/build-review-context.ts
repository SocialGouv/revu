import { getCodingGuidelines } from '../config-handler.ts'
import type { PlatformContext } from '../core/models/platform-types.ts'
import { cleanUpRepository, fetchRelatedIssues } from '../repo-utils.ts'
import { prepareRepositoryForReview } from './prepare-repository-for-review.ts'

export interface ReviewContextData {
  prTitle?: string
  prBody?: string
  diff: string
  modifiedFilesContent: Record<string, string>
  codingGuidelines: string
  relatedIssues: Array<{ number: number; title: string }>
  commitSha: string
  repoPath: string
}

/**
 * Builds a normalized review context used by both the initial review and discussion replies.
 * It centralizes repository preparation, diff extraction, file contents, guidelines and related issues.
 */
export async function buildReviewContext(
  repositoryUrl: string,
  branch: string,
  context: PlatformContext
): Promise<ReviewContextData> {
  // Setup repository and extract PR data using shared utility
  const { repoPath, diff, modifiedFilesContent, commitSha } =
    await prepareRepositoryForReview(repositoryUrl, branch, context)

  // Get coding guidelines from configuration
  let codingGuidelines = ''
  try {
    codingGuidelines = await getCodingGuidelines(repoPath)
  } catch (error) {
    console.warn(
      `Failed to load coding guidelines: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  // Fetch related issues using platform client
  const relatedIssues = await fetchRelatedIssues(context)

  // Clean up cloned repository (we only need its contents for building prompt)
  await cleanUpRepository(repoPath)

  return {
    prTitle: context?.prTitle,
    prBody:
      context?.prBody && context.prBody.length > 16
        ? context.prBody
        : undefined,
    diff,
    modifiedFilesContent,
    codingGuidelines,
    relatedIssues,
    commitSha,
    repoPath
  }
}
