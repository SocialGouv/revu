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
  // Setup repository and extract PR data using shared utility with guaranteed cleanup
  let repoPath = ''
  try {
    const prepared = await prepareRepositoryForReview(
      repositoryUrl,
      branch,
      context
    )
    repoPath = prepared.repoPath

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

    return {
      prTitle: context?.prTitle,
      prBody:
        context?.prBody && context.prBody.length > 16
          ? context.prBody
          : undefined,
      diff: prepared.diff,
      modifiedFilesContent: prepared.modifiedFilesContent,
      codingGuidelines,
      relatedIssues,
      commitSha: prepared.commitSha,
      repoPath: prepared.repoPath
    }
  } finally {
    if (repoPath) {
      try {
        await cleanUpRepository(repoPath)
      } catch {
        // swallow cleanup errors
      }
    }
  }
}
