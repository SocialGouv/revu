import { Octokit } from '@octokit/rest'
import type { ProbotOctokit } from 'probot'
import type {
  IssueDetails,
  PlatformClient
} from '../../core/models/platform-types.ts'
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
        logSystemError(`Error fetching issue #${issueNumber}: ${error}`, {
          repository: `${owner}/${repo}`
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

      const commentParams = {
        owner,
        repo,
        pull_number: params.prNumber,
        commit_id: params.commitSha,
        path: params.path,
        line: params.line,
        body: params.body,
        side: 'RIGHT',
        start_line: params.startLine
      }

      await proxyClient.pulls.createReviewComment(commentParams)
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
        number: data.number
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
        logSystemError(
          `Error fetching review comment #${commentId}: ${error}`,
          {
            repository: `${owner}/${repo}`
          }
        )
        return null
      }
    }
  }
}
