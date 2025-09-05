import { describe, expect, it, vi } from 'vitest'
import {
  extractPRInfo,
  isPullRequestOpened
} from '../src/platforms/github/reviewer-utils.ts'

// Mock environment variables
vi.stubEnv('PROXY_REVIEWER_USERNAME', 'proxy-reviewer-user')

describe('On-Demand Review - Real Tests', () => {
  describe('isPullRequestOpened', () => {
    it('should return true for opened action', () => {
      const event = {
        action: 'opened',
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

      expect(isPullRequestOpened(event)).toBe(true)
    })

    it('should return false for non-opened actions', () => {
      const actions = [
        'closed',
        'edited',
        'synchronize',
        'reopened',
        'requested'
      ]

      actions.forEach((action) => {
        const event = {
          action,
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

        expect(isPullRequestOpened(event)).toBe(false)
      })
    })
  })

  describe('extractPRInfo', () => {
    it('should extract PR information correctly', () => {
      const event = {
        action: 'opened',
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

      const result = extractPRInfo(event)

      expect(result).toEqual({
        number: 123,
        owner: 'test-owner',
        repo: 'test-repo'
      })
    })

    it('should handle different PR numbers and repository info', () => {
      const event = {
        action: 'opened',
        pull_request: {
          number: 456
        },
        repository: {
          name: 'my-project',
          owner: {
            login: 'my-org'
          }
        }
      }

      const result = extractPRInfo(event)

      expect(result).toEqual({
        number: 456,
        owner: 'my-org',
        repo: 'my-project'
      })
    })

    it('should work with various event types', () => {
      const reviewRequestEvent = {
        action: 'requested',
        requested_reviewer: {
          login: 'revu-bot[bot]',
          type: 'Bot'
        },
        pull_request: {
          number: 789
        },
        repository: {
          name: 'another-repo',
          owner: {
            login: 'another-org'
          }
        }
      }

      const result = extractPRInfo(reviewRequestEvent)

      expect(result).toEqual({
        number: 789,
        owner: 'another-org',
        repo: 'another-repo'
      })
    })
  })
})
