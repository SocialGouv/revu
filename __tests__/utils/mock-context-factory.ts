import { vi } from 'vitest'
import { Context } from 'probot'

export interface MockContextOptions {
  prNumber?: number
  withLogging?: boolean
  existingReviewers?: Array<{ login: string; type: string }>
  repoName?: string
  repoOwner?: string
  botSlug?: string
  installationId?: number
  prAuthor?: { login: string; type: string }
}

export function createMockRequestReviewers() {
  return vi.fn().mockResolvedValue({
    data: {
      requested_reviewers: [
        {
          login: 'revu-bot[bot]',
          type: 'Bot'
        }
      ]
    }
  })
}

export interface MockContextResult {
  context: Context
  mockRequestReviewers: ReturnType<typeof vi.fn>
}

export function createMockContext(options: MockContextOptions = {}): Context {
  const {
    prNumber = 123,
    withLogging = false,
    existingReviewers = [],
    repoName = 'test-repo',
    repoOwner = 'test-owner',
    botSlug = 'revu-bot',
    installationId = 12345,
    prAuthor = { login: 'developer', type: 'User' }
  } = options

  const baseContext = {
    payload: {
      pull_request: {
        number: prNumber,
        user: prAuthor,
        requested_reviewers: existingReviewers
      },
      repository: {
        name: repoName,
        owner: {
          login: repoOwner
        }
      },
      installation: {
        id: installationId
      }
    },
    repo: () => ({
      owner: repoOwner,
      repo: repoName
    }),
    octokit: {
      apps: {
        getAuthenticated: vi.fn().mockResolvedValue({
          data: {
            slug: botSlug
          }
        })
      },
      pulls: {
        requestReviewers: createMockRequestReviewers()
      }
    }
  }

  if (withLogging) {
    return {
      ...baseContext,
      log: {
        info: vi.fn(),
        error: vi.fn()
      }
    } as unknown as Context
  }

  return baseContext as unknown as Context
}

export function createMockContextWithReviewers(
  options: MockContextOptions = {}
): MockContextResult {
  const {
    prNumber = 123,
    withLogging = false,
    existingReviewers = [],
    repoName = 'test-repo',
    repoOwner = 'test-owner',
    botSlug = 'revu-bot',
    installationId = 12345,
    prAuthor = { login: 'developer', type: 'User' }
  } = options

  const mockRequestReviewers = createMockRequestReviewers()

  const baseContext = {
    payload: {
      pull_request: {
        number: prNumber,
        user: prAuthor,
        requested_reviewers: existingReviewers
      },
      repository: {
        name: repoName,
        owner: {
          login: repoOwner
        }
      },
      installation: {
        id: installationId
      }
    },
    repo: () => ({
      owner: repoOwner,
      repo: repoName
    }),
    octokit: {
      apps: {
        getAuthenticated: vi.fn().mockResolvedValue({
          data: {
            slug: botSlug
          }
        })
      },
      pulls: {
        requestReviewers: mockRequestReviewers
      }
    }
  }

  const context = withLogging
    ? ({
        ...baseContext,
        log: {
          info: vi.fn(),
          error: vi.fn()
        }
      } as unknown as Context)
    : (baseContext as unknown as Context)

  return { context, mockRequestReviewers }
}
