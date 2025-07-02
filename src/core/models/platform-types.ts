import type { DiffFileMap } from './diff-types.ts'

/**
 * Interface for issue details that can be fetched from any platform
 */
export interface IssueDetails {
  number: number
  title: string
  body: string | null
  state: string
  comments: Array<{
    id: number
    body: string
  }>
}

/**
 * Interface for review details
 */
export interface Review {
  id: number
  user: {
    login: string
  } | null
  body: string | null
  submitted_at: string | null
}

/**
 * Platform-agnostic client interface for interacting with code hosting platforms
 */
export interface PlatformClient {
  fetchPullRequestDiff: (prNumber: number) => Promise<string>
  fetchIssueDetails: (issueNumber: number) => Promise<IssueDetails | null>
  cloneRepository: (
    url: string,
    branch: string,
    destination: string
  ) => Promise<void>

  // Comment operations
  createReview: (prNumber: number, body: string) => Promise<void>
  /**
   * Creates a review comment on a pull request
   * @param params.line - The last line of the comment range (required)
   * @param params.startLine - The first line of the comment range (optional, for multi-line comments)
   *                          Must be less than or equal to line. If equal to line, creates a single-line comment.
   *                          If less than line, creates a multi-line comment spanning from startLine to line.
   */
  createReviewComment: (params: {
    prNumber: number
    commitSha: string
    path: string
    line: number
    startLine?: number
    body: string
  }) => Promise<void>
  updateReviewComment: (commentId: number, body: string) => Promise<void>

  // PR operations
  getPullRequest: (prNumber: number) => Promise<{
    head: { sha: string }
    number: number
    state: string
    mergeable: boolean | null
    title: string
    body: string | null
  }>

  // Review comment operations
  listReviewComments: (prNumber: number) => Promise<
    Array<{
      id: number
      path: string
      line: number
      body: string
    }>
  >
  getReviewComment: (commentId: number) => Promise<{
    id: number
    body: string
  } | null>
  deleteReviewComment: (commentId: number) => Promise<void>

  // New platform-agnostic methods to replace legacy functions
  fetchPullRequestDiffMap: (prNumber: number) => Promise<DiffFileMap>
  getFileContent: (filePath: string, commitSha: string) => Promise<string>
  listReviews: (prNumber: number) => Promise<Array<Review>>
}

/**
 * Platform-agnostic context for prompt strategies
 */
export interface PlatformContext {
  repoOwner: string
  repoName: string
  prNumber?: number
  prTitle?: string
  prBody?: string
  client: PlatformClient
}
