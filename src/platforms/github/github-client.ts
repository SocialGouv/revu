import { Octokit } from '@octokit/rest'
import type { ProbotOctokit } from 'probot'
import type { DiffFileMap } from '../../core/models/diff-types.ts'
import type {
  IssueDetails,
  PlatformClient,
  Review
} from '../../core/models/platform-types.ts'
import { parseDiff } from '../../core/services/diff-parser.ts'
import { cloneRepository } from '../../repo-utils.ts'
import { logSystemError } from '../../utils/logger.ts'
import { attachOctokitRetry } from '../../github/retry-hook.ts'

/**
 * Creates a GitHub-specific implementation of PlatformClient
 * @param octokit - The Probot Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - Optional GitHub access token for private repositories
 * @returns PlatformClient implementation for GitHub
 */
// Helper functions for createReviewComment

/**
 * Validates line number parameters to prevent GitHub API errors
 * Ensures line numbers are positive and start_line <= line for multi-line comments
 */
const validateCommentParams = (params: {
  line: number
  startLine?: number
}): void => {
  if (params.line <= 0) {
    throw new Error(
      `Invalid line number: ${params.line}. Line numbers must be positive.`
    )
  }

  if (params.startLine !== undefined) {
    if (params.startLine <= 0) {
      throw new Error(
        `Invalid start_line number: ${params.startLine}. Line numbers must be positive.`
      )
    }
    if (params.startLine > params.line) {
      throw new Error(
        `Invalid line range: start_line (${params.startLine}) must be <= line (${params.line}). ` +
          `GitHub API requires start_line to precede or equal the end line for multi-line comments.`
      )
    }
  }
}

/**
 * Builds GitHub API parameters for creating review comments
 * Conditionally includes start_line/start_side for multi-line comments
 * @param includeStartLine - Whether to include start_line parameters (false for fallback)
 */
const buildCommentParams = (
  owner: string,
  repo: string,
  params: {
    prNumber: number
    commitSha: string
    path: string
    line: number
    startLine?: number
    body: string
  },
  includeStartLine: boolean = true
) => {
  const shouldIncludeStartLine =
    includeStartLine &&
    params.startLine !== undefined &&
    params.startLine < params.line

  return {
    owner,
    repo,
    pull_number: params.prNumber,
    commit_id: params.commitSha,
    path: params.path,
    line: params.line,
    body: params.body,
    side: 'RIGHT' as const,
    ...(shouldIncludeStartLine && {
      start_line: params.startLine,
      start_side: 'RIGHT' as const
    })
  }
}

/**
 * Analyzes GitHub API errors to build descriptive error messages
 * Determines if a fallback to single-line comment should be attempted
 * @returns Object with error message and fallback recommendation
 */
const analyzeGitHubError = (
  error: unknown,
  params: { path: string; line: number; startLine?: number }
): { errorMessage: string; shouldAttemptFallback: boolean } => {
  if (!(error && typeof error === 'object' && 'status' in error)) {
    return { errorMessage: 'Unknown error', shouldAttemptFallback: false }
  }

  const apiError = error as {
    status: number
    message?: string
    response?: { data?: unknown }
  }

  let errorMessage = `GitHub API error (${apiError.status})`

  if (apiError.response?.data) {
    errorMessage += `: ${JSON.stringify(apiError.response.data)}`
  } else if (apiError.message) {
    errorMessage += `: ${apiError.message}`
  }

  errorMessage += `. Comment params: path=${params.path}, line=${params.line}, startLine=${params.startLine}`

  // Check for potential hunk boundary violation error
  const isPotentialHunkError =
    apiError.status === 422 &&
    apiError.response?.data &&
    params.startLine !== undefined

  if (isPotentialHunkError) {
    const responseData = apiError.response.data as {
      message?: string
      errors?: Array<{ message?: string }>
    }
    const isHunkBoundaryError =
      responseData.message === 'Validation Failed' &&
      responseData.errors?.some((err) =>
        err.message?.includes('must be part of the same hunk')
      )

    return { errorMessage, shouldAttemptFallback: isHunkBoundaryError }
  }

  return { errorMessage, shouldAttemptFallback: false }
}

/**
 * Attempts to create a single-line comment as fallback when multi-line comment fails
 * Used when GitHub API returns hunk boundary violation errors
 */
const attemptFallbackComment = async (
  proxyClient: Octokit,
  owner: string,
  repo: string,
  params: {
    prNumber: number
    commitSha: string
    path: string
    line: number
    body: string
  }
): Promise<void> => {
  console.warn(
    `Multi-line comment failed due to hunk boundary violation. Falling back to single-line comment at line ${params.line}`
  )

  const fallbackParams = buildCommentParams(owner, repo, params, false)

  try {
    await proxyClient.rest.pulls.createReviewComment(fallbackParams)
  } catch (fallbackError) {
    console.error(`Fallback to single-line comment failed:`, fallbackError)
    throw fallbackError
  }
}

export const createGitHubClient = (
  octokit: ProbotOctokit,
  owner: string,
  repo: string,
  token?: string
): PlatformClient => {
  // Create proxy client for operations that need different auth
  const createProxyClient = () => {
    const proxyToken = process.env.PROXY_REVIEWER_TOKEN
    if (!proxyToken) return null
    const client = new Octokit({ auth: proxyToken })
    return attachOctokitRetry(client, { repository: `${owner}/${repo}` })
  }

  return {
    fetchPullRequestDiff: async (prNumber: number): Promise<string> => {
      const response = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        {
          owner,
          repo,
          pull_number: prNumber,
          headers: {
            accept: 'application/vnd.github.v3.diff'
          }
        }
      )
      return response.data as unknown as string
    },

    fetchIssueDetails: async (
      issueNumber: number
    ): Promise<IssueDetails | null> => {
      try {
        const [{ data: issue }, { data: comments }] = await Promise.all([
          octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber
          }),
          octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: issueNumber
          })
        ])

        return {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          comments: comments.map((comment) => ({
            id: comment.id,
            body: comment.body
          }))
        }
      } catch (error) {
        logSystemError(error, {
          repository: `${owner}/${repo}`,
          context_msg: `Error fetching issue #${issueNumber}`
        })
        return null
      }
    },

    cloneRepository: async (
      url: string,
      branch: string,
      destination: string
    ): Promise<void> => {
      await cloneRepository({
        repositoryUrl: url,
        branch,
        destination,
        token
      })
    },

    // Comment operations using proxy client
    createReview: async (prNumber: number, body: string): Promise<void> => {
      const proxyClient = createProxyClient()
      if (!proxyClient) {
        throw new Error('PROXY_REVIEWER_TOKEN not configured')
      }

      await proxyClient.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        body,
        event: 'COMMENT'
      })
    },

    createReviewComment: async (params: {
      prNumber: number
      commitSha: string
      path: string
      line: number
      startLine?: number
      body: string
    }): Promise<void> => {
      const proxyClient = createProxyClient()
      if (!proxyClient) {
        throw new Error('PROXY_REVIEWER_TOKEN not configured')
      }

      // Validate input parameters
      validateCommentParams(params)

      // Build comment parameters for GitHub API
      const commentParams = buildCommentParams(owner, repo, params)

      try {
        await proxyClient.rest.pulls.createReviewComment(commentParams)
      } catch (error) {
        const { errorMessage, shouldAttemptFallback } = analyzeGitHubError(
          error,
          params
        )

        if (shouldAttemptFallback) {
          try {
            await attemptFallbackComment(proxyClient, owner, repo, params)
            return // Success with fallback
          } catch (fallbackError) {
            // Log the fallback error for debugging
            logSystemError('Fallback error:', fallbackError)
            throw new Error(`${errorMessage} (fallback also failed)`)
          }
        }

        throw new Error(errorMessage)
      }
    },

    updateReviewComment: async (
      commentId: number,
      body: string
    ): Promise<void> => {
      const proxyClient = createProxyClient()
      if (!proxyClient) {
        throw new Error('PROXY_REVIEWER_TOKEN not configured')
      }

      await proxyClient.rest.pulls.updateReviewComment({
        owner,
        repo,
        comment_id: commentId,
        body
      })
    },

    replyToReviewComment: async (
      prNumber: number,
      parentCommentId: number,
      body: string
    ): Promise<void> => {
      const proxyClient = createProxyClient()
      if (!proxyClient) {
        throw new Error('PROXY_REVIEWER_TOKEN not configured')
      }

      await proxyClient.rest.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        comment_id: parentCommentId,
        body
      })
    },

    // PR operations
    getPullRequest: async (prNumber: number) => {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      })
      return {
        head: { sha: data.head.sha },
        number: data.number,
        state: data.state,
        mergeable: data.mergeable,
        title: data.title,
        body: data.body
      }
    },

    // Review comment operations
    listReviewComments: async (prNumber: number) => {
      const { data } = await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber
      })
      return data.map((comment) => ({
        id: comment.id,
        path: comment.path,
        line: comment.line || comment.original_line || 1,
        body: comment.body
      }))
    },

    getReviewComment: async (commentId: number) => {
      try {
        const { data } = await octokit.rest.pulls.getReviewComment({
          owner,
          repo,
          comment_id: commentId
        })
        return {
          id: data.id,
          body: data.body,
          updated_at: data.updated_at
        }
      } catch (error) {
        logSystemError(error, {
          repository: `${owner}/${repo}`,
          context_msg: `Error fetching review comment ${commentId}`
        })
        return null
      }
    },

    deleteReviewComment: async (commentId: number): Promise<void> => {
      const proxyClient = createProxyClient()
      if (!proxyClient) {
        throw new Error('PROXY_REVIEWER_TOKEN not configured')
      }

      await proxyClient.rest.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId
      })
    },

    fetchPullRequestDiffMap: async (prNumber: number): Promise<DiffFileMap> => {
      try {
        const response = await octokit.request(
          'GET /repos/{owner}/{repo}/pulls/{pull_number}',
          {
            owner,
            repo,
            pull_number: prNumber,
            headers: {
              accept: 'application/vnd.github.v3.diff'
            }
          }
        )
        if (typeof response.data !== 'string') {
          throw new Error('Expected diff response to be a string')
        }
        return parseDiff(response.data)
      } catch (error) {
        logSystemError(error, {
          repository: `${owner}/${repo}`,
          pr_number: prNumber,
          context_msg: 'Failed to fetch diff for PR'
        })
        throw error
      }
    },

    getFileContent: async (
      filePath: string,
      commitSha: string
    ): Promise<string> => {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: commitSha
        })

        const data = response.data
        if (!('content' in data) || !data.content) {
          return ''
        }

        // Decode base64 content
        return Buffer.from(data.content, 'base64').toString('utf-8')
      } catch (error) {
        console.warn(`Failed to fetch file content for ${filePath}:`, error)
        return ''
      }
    },

    listReviews: async (prNumber: number): Promise<Array<Review>> => {
      const { data } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber
      })
      return data.map((review) => ({
        id: review.id,
        user: review.user,
        body: review.body,
        submitted_at: review.submitted_at
      }))
    }
  }
}
