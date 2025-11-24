import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest'
import type {
  PlatformClient,
  PlatformContext
} from '../../src/core/models/platform-types.ts'

// Minimal fake PlatformClient
const createMockClient = () => {
  const client: PlatformClient = {
    fetchPullRequestDiff: vi.fn(),
    fetchIssueDetails: vi.fn(),
    cloneRepository: vi.fn(),
    createReview: vi.fn(),
    createReviewComment: vi.fn(),
    updateReviewComment: vi.fn(),
    replyToReviewComment: vi.fn(),
    getPullRequest: vi.fn(),
    listReviewComments: vi.fn(),
    getReviewComment: vi.fn(),
    deleteReviewComment: vi.fn(),
    fetchPullRequestDiffMap: vi.fn(),
    getFileContent: vi.fn(),
    listReviews: vi.fn()
  }
  return client
}

describe('handleDiscussionReply', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('uses fallback reply when LLM returns an exact echo of the user message', async () => {
    const client = createMockClient()

    const userReplyBody = 'user reply'

    // Mock getReviewComment to return matching body/version so we pass stale checks
    ;(client.getReviewComment as unknown as Mock).mockResolvedValue({
      id: 123,
      body: userReplyBody,
      updated_at: 'v1'
    })

    const platformContext: PlatformContext = {
      repoOwner: 'SocialGouv',
      repoName: 'revu',
      prNumber: 262,
      client
    }

    // Mock review context + sender so we control the reply content
    const buildReviewContextMock = vi.fn().mockResolvedValue({
      commitSha: 'abc123'
    })
    const buildDiscussionPromptSegmentsMock = vi.fn().mockReturnValue({} as any)

    // Simulate an unusable reply: exact echo of the user reply body
    const senderMock = vi.fn().mockResolvedValue(userReplyBody)

    vi.doMock('../../src/prompt-strategies/build-review-context.ts', () => ({
      buildReviewContext: buildReviewContextMock
    }))
    vi.doMock(
      '../../src/prompt-strategies/build-discussion-prompt-segments.ts',
      () => ({
        buildDiscussionPromptSegments: buildDiscussionPromptSegmentsMock
      })
    )
    vi.doMock('../../src/senders/index.ts', () => ({
      getDiscussionSender: async () => senderMock
    }))

    // Re-import the handler with mocks applied
    const { handleDiscussionReply: mockedHandleDiscussionReply } = await import(
      '../../src/comment-handlers/discussion-handler.ts'
    )

    const result = await mockedHandleDiscussionReply({
      platformContext,
      prNumber: 262,
      repositoryUrl: 'https://github.com/SocialGouv/revu.git',
      branch: 'main',
      parentCommentId: 111,
      parentCommentBody: 'Parent comment',
      userReplyCommentId: 222,
      userReplyBody,
      owner: 'SocialGouv',
      repo: 'revu',
      history: [],
      cacheTtlSeconds: 3600,
      replyVersion: 'v1'
    })

    // Should not use the raw echo reply
    expect(result).not.toBe(userReplyBody)

    // Should post a generic fallback reply instead
    expect(client.replyToReviewComment).toHaveBeenCalledTimes(1)
    const [[, , body]] = (client.replyToReviewComment as Mock).mock.calls
    expect(typeof body).toBe('string')
    expect(body).toContain('I could not generate a confident, useful automated reply')
  })
})
