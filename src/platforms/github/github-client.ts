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

/**
 * Creates a GitHub-specific implementation of PlatformClient
 * @param octokit - The Probot Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - Optional GitHub access token for private repositories
 * @returns PlatformClient implementation for GitHub
 */
export const createGitHubClient = (
  octokit: ProbotOctokit,
  owner: string,
  repo: string,
  token?: string
): PlatformClient => {
  // Create proxy client for operations that need different auth
  const createProxyClient = () => {
    const proxyToken = process.env.PROXY_REVIEWER_TOKEN
    return proxyToken ? new Octokit({ auth: proxyToken }) : null
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

      await proxyClient.pulls.createReview({
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

      // Validate line parameters to prevent GitHub API errors
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

      // Only include startLine/start_side if startLine is defined and less than line (GitHub API fails when start_line equals line)
      const includeStartLine =
        params.startLine !== undefined && params.startLine < params.line

      const commentParams = {
        owner,
        repo,
        pull_number: params.prNumber,
        commit_id: params.commitSha,
        path: params.path,
        line: params.line,
        body: params.body,
        side: 'RIGHT' as const,
        ...(includeStartLine && {
          start_line: params.startLine,
          start_side: 'RIGHT' as const
        })
      }

      try {
        await proxyClient.pulls.createReviewComment(commentParams)
      } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) {
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

          // Add context about the comment parameters for debugging
          errorMessage += `. Comment params: path=${params.path}, line=${params.line}, startLine=${params.startLine}`

          // Check for hunk boundary violation error and provide fallback
          if (apiError.status === 422 && apiError.response?.data) {
            const responseData = apiError.response.data as {
              message?: string
              errors?: Array<{ message?: string }>
            }
            if (
              responseData.message === 'Validation Failed' &&
              responseData.errors?.some((err) =>
                err.message?.includes('must be part of the same hunk')
              )
            ) {
              // Try fallback to single-line comment if this was a multi-line comment
              if (params.startLine !== undefined) {
                console.warn(
                  `Multi-line comment failed due to hunk boundary violation. Falling back to single-line comment at line ${params.line}`
                )

                const fallbackParams = {
                  owner,
                  repo,
                  pull_number: params.prNumber,
                  commit_id: params.commitSha,
                  path: params.path,
                  line: params.line,
                  body: params.body,
                  side: 'RIGHT' as const
                }

                try {
                  await proxyClient.pulls.createReviewComment(fallbackParams)
                  return // Success with fallback
                } catch (fallbackError) {
                  // Log fallback failure separately to avoid confusing error messages
                  console.error(
                    `Fallback to single-line comment failed:`,
                    fallbackError
                  )
                  // Keep original error message clean
                }
              }
            }
          }

          throw new Error(errorMessage)
        }
        throw error
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

      await proxyClient.pulls.updateReviewComment({
        owner,
        repo,
        comment_id: commentId,
        body
      })
    },

    // PR operations
    getPullRequest: async (prNumber: number) => {
      const { data } = await octokit.pulls.get({
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
      const { data } = await octokit.pulls.listReviewComments({
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
        const { data } = await octokit.pulls.getReviewComment({
          owner,
          repo,
          comment_id: commentId
        })
        return {
          id: data.id,
          body: data.body
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

      await proxyClient.pulls.deleteReviewComment({
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
        const response = await octokit.repos.getContent({
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
      const { data } = await octokit.pulls.listReviews({
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
