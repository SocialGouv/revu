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
