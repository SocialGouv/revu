import { describe, expect, it, vi } from 'vitest'
import { mock } from 'vitest-mock-extended'
import {
} from '../src/platforms/github/reviewer-utils.ts'
import GithubStore from '../src/platforms/github/store.ts'
import { Context } from 'probot'
import type { WebhookEvents } from '@octokit/webhooks/types'

// Mock environment variables
vi.stubEnv('PROXY_REVIEWER_USERNAME', 'proxy-reviewer-user')

describe('GithubStore', () => {
  describe('isReviewRequestedForBot', () => {
    it('should return true when review is requested for proxy user', () => {
      const event = {
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
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = event

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('proxy-reviewer-user')).toBe(true)
    })

    it('should return false when review is requested for another user', () => {
      const event = {
        action: 'review_requested',
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
      } as any
      
      const context = mock<Context<WebhookEvents>>()
      context.payload = event

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('proxy-reviewer-user')).toBe(false)
    })

    it('should return false when action is not "requested"', () => {
      const event = {
        action: 'submitted',
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
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = event

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('proxy-reviewer-user')).toBe(false)
    })

    it('should return false when requested_reviewer is undefined', () => {
      const event = {
        action: 'review_requested',
        pull_request: {
          number: 123
        },
        repository: {
          name: 'test-repo',
          owner: {
            login: 'test-owner'
          }
        }
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = event
      
      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('proxy-reviewer-user')).toBe(false)
    })

    it('should handle edge cases with missing properties', () => {
      const eventWithNullReviewer = {
        action: 'review_requested',
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
      } as any
      
      const context = mock<Context<WebhookEvents>>()
      context.payload = eventWithNullReviewer

      const sut = new GithubStore(context)

      expect(
        sut.isReviewRequestedForBot('proxy-reviewer-user')
      ).toBe(false)
    })
  })

  describe('isPRDraft', () => {
    it('should return true when PR is in draft status', () => {
      const draftPR = { draft: true }

      const context = mock<Context<WebhookEvents>>()
      context.payload = { pull_request: draftPR } as any
      
      const sut = new GithubStore(context)

      expect(sut.isPRDraft()).toBe(true)
    })

    it('should return false when PR is not in draft status', () => {
      const readyPR = { draft: false }

      const context = mock<Context<WebhookEvents>>()
      context.payload = { pull_request: readyPR } as any

      const sut = new GithubStore(context)

      expect(sut.isPRDraft()).toBe(false)
    })

    it('should return false when draft property is undefined', () => {
      const prWithoutDraft = {} as { draft: boolean }

      const context = mock<Context<WebhookEvents>>()
      context.payload = { pull_request: prWithoutDraft } as any

      const sut = new GithubStore(context)

      expect(sut.isPRDraft()).toBe(false)
    })
  })

  describe('Review Request Detection Workflow', () => {
    it('should correctly detect review requests for the bot', () => {
      const reviewRequestEvent = {
        action: 'review_requested',
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
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = reviewRequestEvent

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('revu-bot[bot]')).toBe(
        true
      )
    })

    it('should ignore review requests for other reviewers', () => {
      const reviewRequestEvent = {
        action: 'review_requested',
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
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = reviewRequestEvent

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('revu-bot[bot]')).toBe(
        false
      )
    })

    it('should handle various edge cases in review request detection', () => {
      // Test missing requested_reviewer
      const eventMissingReviewer = {
          action: 'requested',
          pull_request: { number: 123 },
          repository: { name: 'test', owner: { login: 'test' } }
        } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = eventMissingReviewer

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('revu-bot[bot]')).toBe(
        false
      )
    })

    it('should handle various edge cases in review request detection - direct function calls', () => {
      // Test wrong action
      const event = {
        action: 'submitted',
        requested_reviewer: { login: 'revu-bot[bot]', type: 'Bot' },
        pull_request: { number: 123 },
        repository: { name: 'test', owner: { login: 'test' } }
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = event

      const sut = new GithubStore(context)

      expect(sut.isReviewRequestedForBot('revu-bot[bot]')).toBe(
        false
      )
    })

    it('should handle null and undefined properties gracefully', () => {
      const event = {
        action: 'requested',
        requested_reviewer: null,
        pull_request: { number: 123 },
        repository: { name: 'test', owner: { login: 'test' } }
      } as any

      const context = mock<Context<WebhookEvents>>()
      context.payload = event

      const sut = new GithubStore(context)

      // Test null requested_reviewer
      expect(
        sut.isReviewRequestedForBot('revu-bot[bot]')
      ).toBe(false)
    })
  })
})
