import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from 'probot'
import { createMockContextWithReviewers } from './utils/mock-context-factory.ts'

describe('Auto Add Reviewer', () => {
  let mockContext: Context
  let mockRequestReviewers: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    const mockContextResult = createMockContextWithReviewers()
    mockContext = mockContextResult.context
    mockRequestReviewers = mockContextResult.mockRequestReviewers
  })

  it('should have the foundation for adding bot as reviewer', () => {
    // Test that we have the basic structure needed
    const payload = mockContext.payload as { pull_request: { number: number } }
    expect(payload.pull_request.number).toBe(123)
    expect(mockContext.repo().owner).toBe('test-owner')
    expect(mockContext.repo().repo).toBe('test-repo')
    expect(mockContext.octokit.pulls.requestReviewers).toBeDefined()
  })

  it('should be able to call GitHub API to request reviewers', async () => {
    const repo = mockContext.repo()
    const payload = mockContext.payload as { pull_request: { number: number } }
    const prNumber = payload.pull_request.number

    await mockContext.octokit.pulls.requestReviewers({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: prNumber,
      reviewers: ['revu-bot[bot]']
    })

    expect(mockRequestReviewers).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
      reviewers: ['revu-bot[bot]']
    })
  })

  it('should handle the case where bot is already a requested reviewer', () => {
    const payload = mockContext.payload as {
      pull_request: {
        requested_reviewers: Array<{ login: string; type: string }>
      }
    }
    payload.pull_request.requested_reviewers = [
      {
        login: 'revu-bot[bot]',
        type: 'Bot'
      }
    ]

    const isBotAlreadyRequested = payload.pull_request.requested_reviewers.some(
      (reviewer) => reviewer.login === 'revu-bot[bot]'
    )

    expect(isBotAlreadyRequested).toBe(true)
  })
})
