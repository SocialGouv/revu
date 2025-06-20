import { type Context } from 'probot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorCommentHandler } from '../../src/comment-handlers/error-comment-handler.ts'

// Mock upsertComment from global-comment-handler
vi.mock('../../src/comment-handlers/global-comment-handler.ts', () => ({
  upsertComment: vi.fn().mockResolvedValue('Upserted comment')
}))

// Import the mocked function after the mock setup
import { upsertComment } from '../../src/comment-handlers/global-comment-handler.ts'

const mockUpsertComment = vi.mocked(upsertComment)

describe('errorCommentHandler', () => {
  let mockContext: Context
  let mockOctokit: {
    issues: {
      listComments: ReturnType<typeof vi.fn>
    }
  }

  // Mock Date.now() to return a consistent timestamp for testing
  const originalDateNow = Date.now
  const mockTimestamp = 1600000000000 // Fixed timestamp for testing
  const mockTimestampFiveMinutesAgo = mockTimestamp - 300000 // 5 minutes before mockTimestamp

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Mock Date.now()
    Date.now = vi.fn(() => mockTimestamp)

    // Setup mock octokit
    mockOctokit = {
      issues: {
        listComments: vi.fn()
      }
    }

    // Setup mock context
    mockContext = {
      octokit: mockOctokit,
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  afterEach(() => {
    // Restore original Date.now
    Date.now = originalDateNow
  })

  it('should create a new error comment when none exists', async () => {
    // Setup mock to return no existing comments
    mockOctokit.issues.listComments.mockResolvedValue({
      data: []
    })

    const errorMessage = 'Test error message'
    const result = await errorCommentHandler(mockContext, 123, errorMessage)

    // Verify listComments was called to check for existing comments
    expect(mockOctokit.issues.listComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 123
    })

    // Verify upsertComment was called with the correct parameters
    expect(mockUpsertComment).toHaveBeenCalledWith(
      mockContext,
      undefined, // No existing comment
      expect.stringContaining('<!-- REVU-AI-ERROR -->'),
      123
    )

    // Verify the error message is included in the comment
    expect(mockUpsertComment).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.stringContaining('An error occurred: Test error message'),
      123
    )

    // Verify the Grafana logs URL includes the correct timestamps
    expect(mockUpsertComment).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.stringContaining(
        `from%22%3A%22${mockTimestampFiveMinutesAgo}%22%2C%22to%22%3A%22${mockTimestamp}%22`
      ),
      123
    )

    // Verify the result is returned from upsertComment
    expect(result).toBe('Upserted comment')
  })

  it('should update an existing error comment', async () => {
    // Setup mock to return an existing error comment
    const existingComment = {
      id: 456,
      body: '<!-- REVU-AI-ERROR -->\n\nAn error occurred: Old error message'
    }

    mockOctokit.issues.listComments.mockResolvedValue({
      data: [existingComment]
    })

    const errorMessage = 'New error message'
    const result = await errorCommentHandler(mockContext, 123, errorMessage)

    // Verify upsertComment was called with the existing comment
    expect(mockUpsertComment).toHaveBeenCalledWith(
      mockContext,
      existingComment,
      expect.stringContaining('<!-- REVU-AI-ERROR -->'),
      123
    )

    // Verify the new error message is included in the comment
    expect(mockUpsertComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('An error occurred: New error message'),
      expect.anything()
    )

    // Verify the result is returned from upsertComment
    expect(result).toBe('Upserted comment')
  })

  it('should generate a Grafana logs URL with dynamic timestamps', async () => {
    // Setup mock to return no existing comments
    mockOctokit.issues.listComments.mockResolvedValue({
      data: []
    })

    await errorCommentHandler(mockContext, 123, 'Test error')

    // Verify the Grafana logs URL includes the correct timestamps
    expect(mockUpsertComment).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.stringContaining(
        `from%22%3A%22${mockTimestampFiveMinutesAgo}%22%2C%22to%22%3A%22${mockTimestamp}%22`
      ),
      123
    )
  })

  it('should find the correct existing comment when multiple comments exist', async () => {
    // Setup mock to return multiple comments, including an error comment
    const errorComment = {
      id: 789,
      body: '<!-- REVU-AI-ERROR -->\n\nAn error occurred: Old error message'
    }
    const comments = [
      {
        id: 456,
        body: '<!-- REVU-AI-SUMMARY -->\n\nSummary comment'
      },
      {
        id: 111,
        body: 'Regular comment without marker'
      },
      errorComment
    ]

    mockOctokit.issues.listComments.mockResolvedValue({
      data: comments
    })

    await errorCommentHandler(mockContext, 123, 'New error message')

    expect(mockUpsertComment).toHaveBeenCalledWith(
      mockContext,
      errorComment, // The error comment with id 789
      expect.any(String),
      123
    )
  })
})
