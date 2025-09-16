import { Context } from 'probot'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addBotAsReviewer,
  getBotUsername,
  resetBotUsernameCache
} from '../src/platforms/github/reviewer-utils.ts'
import GithubStore from '../src/platforms/github/store.ts'

// Mock environment variables
vi.stubEnv('PROXY_REVIEWER_USERNAME', 'proxy-reviewer-user')

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
      rest: {
        pulls: {
          requestReviewers: mockRequestReviewers
        },
        apps: {
          getAuthenticated: mockGetAuthenticated
        }
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

      // Verify proxy user was added
      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['proxy-reviewer-user']
      })
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added proxy user as reviewer for PR #123'
      )

      // Step 2: Verify bot username can be retrieved
      const botUsername = await getBotUsername(context)
      expect(botUsername).toBe('revu-bot[bot]')
    })

    it('should handle the case where proxy user is already a reviewer', async () => {
      const context = createIntegrationContext({
        existingReviewers: [
          {
            login: 'proxy-reviewer-user',
            type: 'User'
          }
        ]
      })

      // Proxy user should not be added again
      await addBotAsReviewer(context)

      expect(mockRequestReviewers).not.toHaveBeenCalled()
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Proxy user is already a requested reviewer for PR #123'
      )
    })
  })

  describe('Error Handling Integration', () => {
    it('should handle GitHub API failures gracefully', async () => {
      const context = createIntegrationContext({ apiShouldFail: true })

      // Adding reviewer should not throw even if API fails
      await expect(addBotAsReviewer(context)).resolves.not.toThrow()

      // With proxy user, we expect error about adding reviewer, not getting bot username
      expect(mockLogError).toHaveBeenCalledWith(
        'Error adding bot as reviewer: Error: Network Error'
      )

      // Getting bot username should throw an error
      resetBotUsernameCache()
      await expect(getBotUsername(context)).rejects.toThrow('Auth Error')
    })

    it('should handle missing context properties gracefully', async () => {
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

      await addBotAsReviewer(contextWithMissingData)

      // Should still try to add proxy user since requested_reviewers is undefined
      expect(mockRequestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 456,
        reviewers: ['proxy-reviewer-user']
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
          reviewers: ['proxy-reviewer-user']
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

      // Step 1: PR is opened, proxy user is added as reviewer
      await addBotAsReviewer(context)
      expect(mockRequestReviewers).toHaveBeenCalled()

      // Step 2: Developer requests review from proxy user
      const reviewRequestEvent = {
        action: 'review_requested',
        requested_reviewer: {
          login: 'proxy-reviewer-user',
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
      context.payload = reviewRequestEvent as any

      const githubStore = new GithubStore(context)

      // Step 3: System detects review request for proxy user
      const isForProxy = githubStore.isReviewRequestedForBot(
        'proxy-reviewer-user'
      )
      expect(isForProxy).toBe(true)

      // Step 4: Get bot username for further processing (still needed for actual review posting)
      const botUsername = await getBotUsername(context)
      expect(botUsername).toBe('revu-bot[bot]')

      // This would trigger the actual code review process
      // (which would be tested in separate integration tests)
      expect(mockLogInfo).toHaveBeenCalledWith(
        'Successfully added proxy user as reviewer for PR #123'
      )
    })
  })
})
