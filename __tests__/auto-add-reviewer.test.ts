import { Context } from 'probot'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addBotAsReviewer,
  getBotUsername,
  isPRCreatedByBot,
  resetBotUsernameCache
} from '../src/github/reviewer-utils.ts'

// Mock octokit
const mockRequestReviewers = vi.fn()
const mockGetAuthenticated = vi.fn()
const mockLogInfo = vi.fn()
const mockLogError = vi.fn()

// Mock environment variables
vi.stubEnv('PROXY_REVIEWER_USERNAME', 'proxy-reviewer-user')

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
      rest: {
        pulls: {
          requestReviewers: mockRequestReviewers
        },
        apps: {
          getAuthenticated: mockGetAuthenticated
        }
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
    // Reset the cache between tests
    resetBotUsernameCache()
  })

  describe('addBotAsReviewer', () => {
    it('should successfully add proxy user as reviewer when no existing reviewers', async () => {
      const context = createMockContext()

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['proxy-reviewer-user']
      })

      expect(mockRequestReviewers).toHaveBeenCalledTimes(1)
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added proxy user as reviewer for PR #123'
      )
    })

    it('should not add proxy user if already requested', async () => {
      const context = createMockContext({
        existingReviewers: [
          {
            login: 'proxy-reviewer-user',
            type: 'User'
          }
        ]
      })

      await addBotAsReviewer(context)

      expect(mockRequestReviewers).not.toHaveBeenCalled()
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Proxy user is already a requested reviewer for PR #123'
      )
    })

    it('should not add proxy user if another reviewer with same login exists', async () => {
      const context = createMockContext({
        existingReviewers: [
          {
            login: 'proxy-reviewer-user',
            type: 'User'
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
        'Proxy user is already a requested reviewer for PR #123'
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
        reviewers: ['proxy-reviewer-user']
      })

      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added proxy user as reviewer for PR #456'
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
        reviewers: ['proxy-reviewer-user']
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
          rest: {
            pulls: {
              requestReviewers: mockRequestReviewers
            },
            apps: {
              getAuthenticated: mockGetAuthenticated
            }
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
        reviewers: ['proxy-reviewer-user']
      })

      // Verify the correct log message was produced
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added proxy user as reviewer for PR #123'
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

    it('should throw error when API fails', async () => {
      resetBotUsernameCache()
      vi.clearAllMocks()
      mockGetAuthenticated.mockRejectedValue(new Error('API Error'))
      const context = createMockContext()

      await expect(getBotUsername(context)).rejects.toThrow('API Error')
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to get bot username: Error: API Error'
      )
    })

    it('should handle different app slugs', async () => {
      resetBotUsernameCache()
      vi.clearAllMocks()
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

  describe('isPRCreatedByBot', () => {
    it('should correctly identify bots and non-bots', () => {
      const testCases = [
        { user: { login: 'renovate[bot]', type: 'Bot' }, expected: true },
        { user: { login: 'john-doe', type: 'User' }, expected: false },
        { user: { login: 'my-org', type: 'Organization' }, expected: false },
        { user: { login: 'bot-user', type: 'bot' }, expected: true },
        { user: { login: 'bot-user', type: 'bOt' }, expected: true }
      ]

      testCases.forEach(({ user, expected }) => {
        expect(isPRCreatedByBot(user)).toBe(expected)
      })
    })
  })
})
