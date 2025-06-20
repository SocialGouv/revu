import { describe, expect, it } from 'vitest'
import {
  isReviewRequestedForBot,
  extractPRInfo,
  isPullRequestOpened
} from '../src/github/reviewer-utils.ts'

describe('On-Demand Review - Real Tests', () => {
  describe('isReviewRequestedForBot', () => {
    it('should return true when review is requested for revu-bot', () => {
      const event = {
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

      expect(isReviewRequestedForBot(event, 'revu-bot[bot]')).toBe(true)
    })

    it('should return false when review is requested for another user', () => {
      const event = {
        action: 'requested',
        requested_reviewer: {
          login: 'another-user',
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

      expect(isReviewRequestedForBot(event, 'revu-bot[bot]')).toBe(false)
    })

    it('should return false when action is not "requested"', () => {
      const event = {
        action: 'submitted',
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

      expect(isReviewRequestedForBot(event, 'revu-bot[bot]')).toBe(false)
    })

    it('should return false when requested_reviewer is undefined', () => {
      const event = {
        action: 'requested',
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

      expect(isReviewRequestedForBot(event, 'revu-bot[bot]')).toBe(false)
    })

    it('should handle edge cases with missing properties', () => {
      const eventWithNullReviewer = {
        action: 'requested',
        requested_reviewer: null,
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

      expect(
        isReviewRequestedForBot(eventWithNullReviewer, 'revu-bot[bot]')
      ).toBe(false)
    })
  })

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
