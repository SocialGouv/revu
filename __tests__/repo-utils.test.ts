import { Octokit } from '@octokit/rest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractIssueNumbers, fetchIssueDetails } from '../src/repo-utils.ts'

// Mock the logger module
vi.mock('../src/utils/logger.ts', () => ({
  logSystemError: vi.fn()
}))

import { logSystemError } from '../src/utils/logger.ts'

describe('Issue Extraction', () => {
  it('should extract direct issue references', () => {
    const text = 'This PR addresses #123 and also fixes #456'
    const result = extractIssueNumbers(text)
    expect(result).toEqual([123, 456])
  })

  it('should extract GitHub URL references', () => {
    const text = 'Related to https://github.com/owner/repo/issues/123'
    const result = extractIssueNumbers(text)
    expect(result).toEqual([123])
  })

  it('should handle mixed reference types', () => {
    const text = `
      This PR fixes #123 and is related to #456.
      Also closes https://github.com/owner/repo/issues/789
      and resolves #101
    `
    const result = extractIssueNumbers(text)
    expect(result).toEqual([101, 123, 456, 789])
  })

  it('should remove duplicates', () => {
    const text = 'This fixes #123 and also addresses #123 again'
    const result = extractIssueNumbers(text)
    expect(result).toEqual([123])
  })

  it('should return empty array when no issues found', () => {
    const text = 'This PR has no issue references'
    const result = extractIssueNumbers(text)
    expect(result).toEqual([])
  })

  it('should handle empty or null text', () => {
    expect(extractIssueNumbers('')).toEqual([])
  })

  it('should handle whitespace variations', () => {
    const text = 'fixes  #123 and closes\t#456 and resolves\n#789'
    const result = extractIssueNumbers(text)
    expect(result).toEqual([123, 456, 789])
  })
})

describe('fetchIssueDetails', () => {
  let mockOctokit: {
    rest: {
      issues: {
        get: ReturnType<typeof vi.fn>
        listComments: ReturnType<typeof vi.fn>
      }
    }
  }

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Setup mock octokit
    mockOctokit = {
      rest: {
        issues: {
          get: vi.fn(),
          listComments: vi.fn()
        }
      }
    }
  })

  it('should fetch issue details with comments', async () => {
    // Mock issue data
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 123,
        title: 'Test Issue',
        body: 'This is a test issue',
        state: 'open'
      }
    })

    // Mock comments data
    mockOctokit.rest.issues.listComments.mockResolvedValue({
      data: [
        {
          id: 1,
          body: 'First comment'
        },
        {
          id: 2,
          body: 'Second comment'
        }
      ]
    })

    const result = await fetchIssueDetails(
      mockOctokit as unknown as Octokit,
      'test-owner',
      'test-repo',
      123
    )

    // Verify the result
    expect(result).toEqual({
      number: 123,
      title: 'Test Issue',
      body: 'This is a test issue',
      state: 'open',
      comments: [
        {
          id: 1,
          body: 'First comment'
        },
        {
          id: 2,
          body: 'Second comment'
        }
      ]
    })

    // Verify API calls
    expect(mockOctokit.rest.issues.get).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 123
    })

    expect(mockOctokit.rest.issues.listComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 123
    })
  })

  it('should fetch issue details without comments', async () => {
    // Mock issue data
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 456,
        title: 'Another Issue',
        body: null,
        state: 'closed'
      }
    })

    // Mock empty comments
    mockOctokit.rest.issues.listComments.mockResolvedValue({
      data: []
    })

    const result = await fetchIssueDetails(
      mockOctokit as unknown as Octokit,
      'test-owner',
      'test-repo',
      456
    )

    // Verify the result
    expect(result).toEqual({
      number: 456,
      title: 'Another Issue',
      body: null,
      state: 'closed',
      comments: []
    })
  })

  it('should handle API errors and return null', async () => {
    // Mock API error
    mockOctokit.rest.issues.get.mockRejectedValue(new Error('GitHub API Error'))

    const result = await fetchIssueDetails(
      mockOctokit as unknown as Octokit,
      'test-owner',
      'test-repo',
      789
    )

    // Verify the result is null
    expect(result).toBeNull()

    // Verify error was logged
    expect(logSystemError).toHaveBeenCalledWith(new Error('GitHub API Error'), {
      context_msg: 'Error fetching issue #789'
    })
  })

  it('should handle error when fetching comments', async () => {
    // Mock successful issue fetch
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: {
        number: 123,
        title: 'Test Issue',
        body: 'This is a test issue',
        state: 'open'
      }
    })

    // Mock error when fetching comments
    mockOctokit.rest.issues.listComments.mockRejectedValue(
      new Error('Comments API Error')
    )

    const result = await fetchIssueDetails(
      mockOctokit as unknown as Octokit,
      'test-owner',
      'test-repo',
      123
    )

    // Verify the result is null
    expect(result).toBeNull()

    // Verify error was logged
    expect(logSystemError).toHaveBeenCalledWith(
      new Error('Comments API Error'),
      {
        context_msg: 'Error fetching issue #123'
      }
    )
  })
})
