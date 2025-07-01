import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformContext } from '../../src/core/models/platform-types.ts'
import { errorCommentHandler } from '../../src/comment-handlers/error-comment-handler.ts'

describe('errorCommentHandler', () => {
  let mockPlatformContext: PlatformContext
  let mockClient: {
    createReview: ReturnType<typeof vi.fn>
  }

  // Mock Date.now() to return a consistent timestamp for testing
  const originalDateNow = Date.now
  const mockTimestamp = 1600000000000 // Fixed timestamp for testing
  const mockTimestampFiveMinutesLater = mockTimestamp + 300000 // 5 minutes after mockTimestamp
  const mockTimestampFiveMinutesAgo = mockTimestamp - 300000 // 5 minutes before mockTimestamp

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Mock Date.now()
    Date.now = vi.fn(() => mockTimestamp)

    // Setup mock client
    mockClient = {
      createReview: vi.fn().mockResolvedValue('Posted error comment on PR #123')
    }

    // Setup mock platform context
    mockPlatformContext = {
      repoOwner: 'test-owner',
      repoName: 'test-repo',
      client: mockClient
    } as unknown as PlatformContext
  })

  afterEach(() => {
    // Restore original Date.now
    Date.now = originalDateNow
  })

  it('should create an error comment with correct content', async () => {
    const errorMessage = 'Test error message'
    const result = await errorCommentHandler(
      mockPlatformContext,
      123,
      errorMessage
    )

    // Verify createReview was called with the correct parameters
    expect(mockClient.createReview).toHaveBeenCalledWith(
      123,
      expect.stringContaining('<!-- REVU-AI-ERROR -->')
    )

    // Verify the error message is included in the comment
    expect(mockClient.createReview).toHaveBeenCalledWith(
      123,
      expect.stringContaining('An error occurred: Test error message')
    )

    // Verify the Grafana logs URL includes the correct timestamps
    expect(mockClient.createReview).toHaveBeenCalledWith(
      123,
      expect.stringContaining(
        `from%22%3A%22${mockTimestampFiveMinutesAgo}%22%2C%22to%22%3A%22${mockTimestampFiveMinutesLater}%22`
      )
    )

    // Verify the result message
    expect(result).toBe('Posted error comment on PR #123')
  })

  it('should generate a Grafana logs URL with dynamic timestamps', async () => {
    await errorCommentHandler(mockPlatformContext, 456, 'Test error')

    // Verify the Grafana logs URL includes the correct timestamps
    expect(mockClient.createReview).toHaveBeenCalledWith(
      456,
      expect.stringContaining(
        `from%22%3A%22${mockTimestampFiveMinutesAgo}%22%2C%22to%22%3A%22${mockTimestampFiveMinutesLater}%22`
      )
    )
  })

  it('should handle createReview failure gracefully', async () => {
    const error = new Error('Network error')
    mockClient.createReview.mockRejectedValue(error)

    const result = await errorCommentHandler(
      mockPlatformContext,
      123,
      'Test error'
    )

    // Verify the error is handled and a failure message is returned
    expect(result).toBe('Failed to post error comment: Network error')
  })

  it('should include the error marker in the comment', async () => {
    await errorCommentHandler(mockPlatformContext, 123, 'Test error')

    // Verify the comment includes the error marker
    expect(mockClient.createReview).toHaveBeenCalledWith(
      123,
      expect.stringContaining('<!-- REVU-AI-ERROR -->')
    )
  })

  it('should include the Grafana logs link in the comment', async () => {
    await errorCommentHandler(mockPlatformContext, 123, 'Test error')

    // Verify the comment includes the Grafana logs link
    expect(mockClient.createReview).toHaveBeenCalledWith(
      123,
      expect.stringContaining(
        '[Revu logs](https://grafana.fabrique.social.gouv.fr/explore'
      )
    )
  })
})
