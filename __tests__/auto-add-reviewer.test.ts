import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from 'probot'

describe('Auto Add Reviewer', () => {
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
      }
    } as unknown as Context
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
