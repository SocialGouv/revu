import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from 'probot'
import {
  addBotAsReviewer,
  isReviewRequestedForBot
} from '../src/github/reviewer-utils.ts'

describe('Integration Tests - On-Demand Reviews', () => {
  let mockContext: Context
  let mockRequestReviewers: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    mockRequestReviewers = vi.fn().mockResolvedValue({
      data: {
        requested_reviewers: [
          {
            login: 'revu-bot[bot]',
            type: 'Bot'
          }
        ]
      }
    })

    mockContext = {
      payload: {
        pull_request: {
          number: 123,
          user: {
            login: 'developer',
            type: 'User'
          },
          requested_reviewers: []
        },
        repository: {
          name: 'test-repo',
          owner: {
            login: 'test-owner'
          }
        },
        installation: {
          id: 12345
        }
      },
      repo: () => ({
        owner: 'test-owner',
        repo: 'test-repo'
      }),
      octokit: {
        apps: {
          getAuthenticated: vi.fn().mockResolvedValue({
            data: {
              slug: 'revu-bot'
            }
          })
        },
        pulls: {
          requestReviewers: mockRequestReviewers
        }
      },
      log: {
        info: vi.fn(),
        error: vi.fn()
      }
    } as unknown as Context
  })

  it('should add bot as reviewer on PR opened', async () => {
    await addBotAsReviewer(mockContext)

    expect(mockRequestReviewers).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
      reviewers: ['revu-bot[bot]']
    })

    expect(mockContext.log.info).toHaveBeenCalledWith(
      'Successfully added bot as reviewer for PR #123'
    )
  })

  it('should not add bot if already requested', async () => {
    // Setup: bot already in requested reviewers
    const payload = mockContext.payload as {
      pull_request: {
        number: number
        user: { login: string; type: string }
        requested_reviewers: Array<{ login: string; type: string }>
      }
    }
    payload.pull_request.requested_reviewers = [
      {
        login: 'revu-bot[bot]',
        type: 'Bot'
      }
    ]

    await addBotAsReviewer(mockContext)

    expect(mockRequestReviewers).not.toHaveBeenCalled()
    expect(mockContext.log.info).toHaveBeenCalledWith(
      'Bot is already a requested reviewer for PR #123'
    )
  })

  it('should detect review requested for bot', () => {
    const reviewRequestEvent = {
      action: 'requested',
      requested_reviewer: {
        login: 'revu-bot[bot]',
        type: 'Bot'
      },
      pull_request: {
        number: 123
      },
      repository: {
        name: 'test-repo',
        owner: {
          login: 'test-owner'
        }
      }
    }

    expect(isReviewRequestedForBot(reviewRequestEvent)).toBe(true)
  })

  it('should ignore review request for other users', () => {
    const reviewRequestEvent = {
      action: 'requested',
      requested_reviewer: {
        login: 'other-user',
        type: 'User'
      },
      pull_request: {
        number: 123
      },
      repository: {
        name: 'test-repo',
        owner: {
          login: 'test-owner'
        }
      }
    }

    expect(isReviewRequestedForBot(reviewRequestEvent)).toBe(false)
  })

  it('should handle errors gracefully when adding reviewer', async () => {
    mockRequestReviewers.mockRejectedValue(new Error('GitHub API Error'))

    // Should not throw an error
    await expect(addBotAsReviewer(mockContext)).resolves.not.toThrow()

    expect(mockContext.log.error).toHaveBeenCalledWith(
      'Error adding bot as reviewer: Error: GitHub API Error'
    )
  })

  it('should complete the full workflow', async () => {
    // Step 1: Bot gets added as reviewer when PR is opened
    await addBotAsReviewer(mockContext)
    expect(mockRequestReviewers).toHaveBeenCalled()

    // Step 2: Review is requested for the bot
    const reviewRequestEvent = {
      action: 'requested',
      requested_reviewer: {
        login: 'revu-bot[bot]',
        type: 'Bot'
      },
      pull_request: {
        number: 123
      },
      repository: {
        name: 'test-repo',
        owner: {
          login: 'test-owner'
        }
      }
    }

    expect(isReviewRequestedForBot(reviewRequestEvent)).toBe(true)

    // This would trigger the actual code review process
    // (tested separately in other test files)
  })
})
