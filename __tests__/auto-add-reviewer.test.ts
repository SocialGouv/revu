import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from 'probot'
import {
  addBotAsReviewer,
  getBotUsername
} from '../src/github/reviewer-utils.ts'

// Mock octokit
const mockRequestReviewers = vi.fn()
const mockGetAuthenticated = vi.fn()
const mockLogInfo = vi.fn()
const mockLogError = vi.fn()

// Create a real Context mock that matches the actual interface
function createMockContext(
  options: {
    existingReviewers?: Array<{ login: string; type: string }>
    prNumber?: number
    owner?: string
    repo?: string
    shouldThrowError?: boolean
  } = {}
): Context {
  const {
    existingReviewers = [],
    prNumber = 123,
    owner = 'test-owner',
    repo = 'test-repo',
    shouldThrowError = false
  } = options

  if (shouldThrowError) {
    mockRequestReviewers.mockRejectedValue(new Error('GitHub API Error'))
  } else {
    // Simple success response - the returned data is not used in the actual logic
    mockRequestReviewers.mockResolvedValue({ data: {} })
  }

  return {
    payload: {
      pull_request: {
        number: prNumber,
        requested_reviewers: existingReviewers
      }
    },
    repo: () => ({
      owner,
      repo
    }),
    octokit: {
      pulls: {
        requestReviewers: mockRequestReviewers
      },
      apps: {
        getAuthenticated: mockGetAuthenticated
      }
    },
    log: {
      info: mockLogInfo,
      error: mockLogError
    }
  } as unknown as Context
}

describe('Auto Add Reviewer - Real Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default bot slug for consistency
    mockGetAuthenticated.mockResolvedValue({
      data: {
        slug: 'revu-bot'
      }
    })
  })

  describe('addBotAsReviewer', () => {
    it('should successfully add bot as reviewer when no existing reviewers', async () => {
      const context = createMockContext()

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['revu-bot[bot]']
      })

      expect(mockRequestReviewers).toHaveBeenCalledTimes(1)
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added bot as reviewer for PR #123'
      )
    })

    it('should not add bot if already requested', async () => {
      const context = createMockContext({
        existingReviewers: [
          {
            login: 'revu-bot[bot]',
            type: 'Bot'
          }
        ]
      })

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).not.toHaveBeenCalled()
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Bot is already a requested reviewer for PR #123'
      )
    })

    it('should not add bot if another reviewer with same login exists', async () => {
      const context = createMockContext({
        existingReviewers: [
          {
            login: 'revu-bot[bot]',
            type: 'Bot'
          },
          {
            login: 'human-reviewer',
            type: 'User'
          }
        ]
      })

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).not.toHaveBeenCalled()
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Bot is already a requested reviewer for PR #123'
      )
    })

    it('should handle GitHub API errors gracefully', async () => {
      const context = createMockContext({ shouldThrowError: true })

      // Should not throw
      await expect(addBotAsReviewer(context)).resolves.not.toThrow()

      expect(mockRequestReviewers).toHaveBeenCalled()
      expect(mockLogError).toHaveBeenCalledWith(
        'Error adding bot as reviewer: Error: GitHub API Error'
      )
    })

    it('should work with different PR numbers and repositories', async () => {
      const context = createMockContext({
        prNumber: 456,
        owner: 'my-org',
        repo: 'my-project'
      })

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'my-org',
        repo: 'my-project',
        pull_number: 456,
        reviewers: ['revu-bot[bot]']
      })

      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added bot as reviewer for PR #456'
      )
    })

    it('should work with custom bot slug', async () => {
      // Override the bot slug for this specific test
      mockGetAuthenticated.mockResolvedValue({
        data: {
          slug: 'my-custom-bot'
        }
      })

      const context = createMockContext()

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['my-custom-bot[bot]']
      })

      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added bot as reviewer for PR #123'
      )
    })

    it('should handle empty requested_reviewers array', async () => {
      const context = createMockContext({
        existingReviewers: []
      })

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).toHaveBeenCalled()

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['revu-bot[bot]']
      })
    })

    it('should handle undefined requested_reviewers', async () => {
      const context = {
        payload: {
          pull_request: {
            number: 123
            // requested_reviewers is undefined
          }
        },
        repo: () => ({
          owner: 'test-owner',
          repo: 'test-repo'
        }),
        octokit: {
          pulls: {
            requestReviewers: mockRequestReviewers
          },
          apps: {
            getAuthenticated: mockGetAuthenticated
          }
        },
        log: {
          info: mockLogInfo,
          error: mockLogError
        }
      } as unknown as Context

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['revu-bot[bot]']
      })

      // Verify the correct log message was produced
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added bot as reviewer for PR #123'
      )

      // Verify no errors were logged
      expect(mockLogError).not.toHaveBeenCalled()
    })
  })

  describe('getBotUsername', () => {
    it('should return correct bot username from GitHub API', async () => {
      const context = createMockContext()

      const username = await getBotUsername(context)

      expect(username).toBe('revu-bot[bot]')
      expect(mockGetAuthenticated).toHaveBeenCalled()
    })

    it('should return fallback username when API fails', async () => {
      mockGetAuthenticated.mockRejectedValue(new Error('API Error'))
      const context = createMockContext()

      const username = await getBotUsername(context)

      expect(username).toBe('revu-bot[bot]')
      expect(mockLogError).toHaveBeenCalledWith(
        'Error getting bot username: Error: API Error'
      )
    })

    it('should handle different app slugs', async () => {
      mockGetAuthenticated.mockResolvedValue({
        data: {
          slug: 'my-custom-bot'
        }
      })
      const context = createMockContext()

      const username = await getBotUsername(context)

      expect(username).toBe('my-custom-bot[bot]')
    })
  })
})
