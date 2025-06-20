import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from 'probot'
import {
  addBotAsReviewer,
  isReviewRequestedForBot,
  getBotUsername,
  resetBotUsernameCache
} from '../src/github/reviewer-utils.ts'

// Mock octokit methods for integration testing
const mockRequestReviewers = vi.fn()
const mockGetAuthenticated = vi.fn()
const mockLogInfo = vi.fn()
const mockLogError = vi.fn()

// Create a more realistic Context mock for integration testing
function createIntegrationContext(
  options: {
    prNumber?: number
    owner?: string
    repo?: string
    existingReviewers?: Array<{ login: string; type: string }>
    botSlug?: string
    apiShouldFail?: boolean
    withLogging?: boolean
  } = {}
): Context {
  const {
    prNumber = 123,
    owner = 'test-owner',
    repo = 'test-repo',
    existingReviewers = [],
    botSlug = 'revu-bot',
    apiShouldFail = false,
    withLogging = true
  } = options

  // Configure mocks based on test scenario
  if (apiShouldFail) {
    mockRequestReviewers.mockRejectedValue(new Error('Network Error'))
    mockGetAuthenticated.mockRejectedValue(new Error('Auth Error'))
  } else {
    mockRequestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [
          {
            login: `${botSlug}[bot]`,
            type: 'Bot'
          }
        ]
      }
    })
    mockGetAuthenticated.mockResolvedValue({
      data: {
        slug: botSlug
      }
    })
  }

  const baseContext = {
    payload: {
      pull_request: {
        number: prNumber,
        user: {
          login: 'developer',
          type: 'User'
        },
        requested_reviewers: existingReviewers
      },
      repository: {
        name: repo,
        owner: {
          login: owner
        }
      },
      installation: {
        id: 12345
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
    }
  }

  if (withLogging) {
    return {
      ...baseContext,
      log: {
        info: mockLogInfo,
        error: mockLogError
      }
    } as unknown as Context
  }

  return baseContext as unknown as Context
}

describe('Integration Tests - Real Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBotUsernameCache()
  })

  describe('Complete PR Opened Workflow', () => {
    it('should successfully complete the full PR opened workflow', async () => {
      const context = createIntegrationContext()

      // Step 1: Add bot as reviewer (happens when PR is opened)
      await addBotAsReviewer(context)

      // Verify bot was added
      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['revu-bot[bot]']
      })
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added bot as reviewer for PR #123'
      )

      // Step 2: Verify bot username can be retrieved
      const botUsername = await getBotUsername(context)
      expect(botUsername).toBe('revu-bot[bot]')
    })

    it('should handle the case where bot is already a reviewer', async () => {
      const context = createIntegrationContext({
        existingReviewers: [
          {
            login: 'revu-bot[bot]',
            type: 'Bot'
          }
        ]
      })

      // Bot should not be added again
      await addBotAsReviewer(context)

      expect(mockRequestReviewers).not.toHaveBeenCalled()
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Bot is already a requested reviewer for PR #123'
      )
    })
  })

  describe('Review Request Detection Workflow', () => {
    it('should correctly detect review requests for the bot', () => {
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

      expect(isReviewRequestedForBot(reviewRequestEvent, 'revu-bot[bot]')).toBe(
        true
      )
    })

    it('should ignore review requests for other reviewers', () => {
      const reviewRequestEvent = {
        action: 'requested',
        requested_reviewer: {
          login: 'human-reviewer',
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

      expect(isReviewRequestedForBot(reviewRequestEvent, 'revu-bot[bot]')).toBe(
        false
      )
    })

    it('should handle various edge cases in review request detection', () => {
      // Test missing requested_reviewer
      expect(
        isReviewRequestedForBot(
          {
            action: 'requested',
            pull_request: { number: 123 },
            repository: { name: 'test', owner: { login: 'test' } }
          },
          'revu-bot[bot]'
        )
      ).toBe(false)

      // Test wrong action
      expect(
        isReviewRequestedForBot(
          {
            action: 'submitted',
            requested_reviewer: { login: 'revu-bot[bot]', type: 'Bot' },
            pull_request: { number: 123 },
            repository: { name: 'test', owner: { login: 'test' } }
          },
          'revu-bot[bot]'
        )
      ).toBe(false)

      // Test null requested_reviewer
      expect(
        isReviewRequestedForBot(
          {
            action: 'requested',
            requested_reviewer: null,
            pull_request: { number: 123 },
            repository: { name: 'test', owner: { login: 'test' } }
          },
          'revu-bot[bot]'
        )
      ).toBe(false)
    })
  })

  describe('Error Handling Integration', () => {
    it('should handle GitHub API failures gracefully', async () => {
      const context = createIntegrationContext({ apiShouldFail: true })

      // Adding reviewer should not throw even if API fails
      await expect(addBotAsReviewer(context)).resolves.not.toThrow()

      // With the new behavior, getBotUsername fails first, then addBotAsReviewer catches and logs that error
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to get bot username: Error: Auth Error'
      )
      expect(mockLogError).toHaveBeenCalledWith(
        'Error adding bot as reviewer: Error: Auth Error'
      )

      // Getting bot username should throw an error
      resetBotUsernameCache()
      await expect(getBotUsername(context)).rejects.toThrow('Auth Error')
    })

    it('should handle missing context properties gracefully', async () => {
      // Make sure the getAuthenticated mock works for this test
      mockGetAuthenticated.mockResolvedValue({
        data: {
          slug: 'revu-bot'
        }
      })

      const contextWithMissingData = {
        payload: {
          pull_request: {
            number: 456
            // missing requested_reviewers
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

      await addBotAsReviewer(contextWithMissingData)

      // Should still try to add reviewer since requested_reviewers is undefined
      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 456,
        reviewers: ['revu-bot[bot]']
      })
    })
  })

  describe('Multi-Repository Integration', () => {
    it('should work correctly across different repositories', async () => {
      const repos = [
        { owner: 'org1', repo: 'repo1', prNumber: 100 },
        { owner: 'org2', repo: 'repo2', prNumber: 200 },
        { owner: 'mycompany', repo: 'backend', prNumber: 300 }
      ]

      for (const repoConfig of repos) {
        const context = createIntegrationContext({
          owner: repoConfig.owner,
          repo: repoConfig.repo,
          prNumber: repoConfig.prNumber
        })

        await addBotAsReviewer(context)

        expect(mockRequestReviewers).toHaveBeenCalledWith({
          owner: repoConfig.owner,
          repo: repoConfig.repo,
          pull_number: repoConfig.prNumber,
          reviewers: ['revu-bot[bot]']
        })
      }

      expect(mockRequestReviewers).toHaveBeenCalledTimes(3)
    })
  })

  describe('Custom Bot Configuration Integration', () => {
    it('should work with custom bot names', async () => {
      resetBotUsernameCache()
      const customBotSlug = 'my-custom-reviewer'
      const context = createIntegrationContext({ botSlug: customBotSlug })

      const username = await getBotUsername(context)
      expect(username).toBe('my-custom-reviewer[bot]')

      // The addBotAsReviewer function uses dynamic bot names from getBotUsername
      // This test shows that getBotUsername works with custom bots
    })
  })

  describe('Complete On-Demand Review Trigger Workflow', () => {
    it('should simulate the complete on-demand review workflow', async () => {
      const context = createIntegrationContext()

      // Step 1: PR is opened, bot is added as reviewer
      await addBotAsReviewer(context)
      expect(mockRequestReviewers).toHaveBeenCalled()

      // Step 2: Developer requests review from bot
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

      // Step 3: System detects review request for bot
      const isForBot = isReviewRequestedForBot(
        reviewRequestEvent,
        'revu-bot[bot]'
      )
      expect(isForBot).toBe(true)

      // Step 4: Get bot username for further processing
      const botUsername = await getBotUsername(context)
      expect(botUsername).toBe('revu-bot[bot]')

      // This would trigger the actual code review process
      // (which would be tested in separate integration tests)
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added bot as reviewer for PR #123'
      )
    })
  })
})
