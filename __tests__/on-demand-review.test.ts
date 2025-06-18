import { describe, expect, it, vi, beforeEach } from 'vitest'

interface MockEvent {
  action: string
  pull_request?: {
    number: number
    user?: {
      login: string
      type: string
    }
    requested_reviewers?: Array<{ login: string; type: string }>
  }
  requested_reviewer?: {
    login: string
    type: string
  }
  repository?: {
    name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
}

describe('On-Demand Review', () => {
  let mockPullRequestReviewEvent: MockEvent
  let mockPullRequestEvent: MockEvent

  beforeEach(() => {
    vi.clearAllMocks()

    mockPullRequestReviewEvent = {
      action: 'requested',
      pull_request: {
        number: 123,
        user: {
          login: 'developer',
          type: 'User'
        }
      },
      requested_reviewer: {
        login: 'revu-bot[bot]',
        type: 'Bot'
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
    }

    mockPullRequestEvent = {
      action: 'opened',
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
    }
  })

  it('should detect when review is requested for the bot', () => {
    const isReviewRequestedForBot = (event: MockEvent) => {
      return (
        event.action === 'requested' &&
        event.requested_reviewer &&
        event.requested_reviewer.login === 'revu-bot[bot]'
      )
    }

    expect(isReviewRequestedForBot(mockPullRequestReviewEvent)).toBe(true)
  })

  it('should not trigger review when requested for another user', () => {
    const isReviewRequestedForBot = (event: MockEvent) => {
      return (
        event.action === 'requested' &&
        event.requested_reviewer &&
        event.requested_reviewer.login === 'revu-bot[bot]'
      )
    }

    mockPullRequestReviewEvent.requested_reviewer = {
      login: 'another-user',
      type: 'User'
    }

    expect(isReviewRequestedForBot(mockPullRequestReviewEvent)).toBe(false)
  })

  it('should identify PR opened events', () => {
    const isPullRequestOpened = (event: MockEvent) => {
      return event.action === 'opened'
    }

    expect(isPullRequestOpened(mockPullRequestEvent)).toBe(true)
    expect(isPullRequestOpened(mockPullRequestReviewEvent)).toBe(false)
  })

  it('should extract PR information correctly', () => {
    const extractPRInfo = (event: MockEvent) => {
      return {
        number: event.pull_request?.number || 0,
        owner: event.repository?.owner?.login || '',
        repo: event.repository?.name || ''
      }
    }

    const prInfo = extractPRInfo(mockPullRequestReviewEvent)
    expect(prInfo).toEqual({
      number: 123,
      owner: 'test-owner',
      repo: 'test-repo'
    })
  })

  it('should handle missing requested_reviewer gracefully', () => {
    const isReviewRequestedForBot = (event: MockEvent) => {
      return Boolean(
        event.action === 'requested' &&
          event.requested_reviewer &&
          event.requested_reviewer.login === 'revu-bot[bot]'
      )
    }

    const eventWithoutRequestedReviewer: MockEvent = {
      action: 'requested',
      pull_request: { number: 123 }
    }

    expect(isReviewRequestedForBot(eventWithoutRequestedReviewer)).toBe(false)
  })
})
