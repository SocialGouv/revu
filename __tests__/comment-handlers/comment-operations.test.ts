import { type Context } from 'probot'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkCommentExistence,
  cleanupObsoleteComments,
  createCommentParams,
  findExistingComments,
  findExistingSummaryComment
} from '../../src/comment-handlers/comment-operations.ts'
import type { Comment } from '../../src/comment-handlers/types.ts'
import { SUMMARY_MARKER } from '../../src/comment-handlers/types.ts'

describe('findExistingComments', () => {
  let mockContext: Context
  let mockOctokit: {
    pulls: {
      listReviewComments: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    mockOctokit = {
      pulls: {
        listReviewComments: vi.fn()
      }
    }

    mockContext = {
      octokit: mockOctokit,
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  it('should find comments with REVU-AI-COMMENT marker', async () => {
    const mockComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nThis is our comment'
      },
      {
        id: 2,
        body: 'Regular comment without marker'
      },
      {
        id: 3,
        body: '<!-- REVU-AI-COMMENT file2.ts:20-25 -->\n\nAnother AI comment'
      },
      {
        id: 4,
        body: '<!-- OTHER-BOT-MARKER -->\n\nOther bot comment'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: mockComments
    })

    const result = await findExistingComments(mockContext, 123)

    expect(mockOctokit.pulls.listReviewComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123
    })

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe(1)
    expect(result[1].id).toBe(3)
  })

  it('should return empty array when no comments have marker', async () => {
    const mockComments = [
      {
        id: 1,
        body: 'Regular comment'
      },
      {
        id: 2,
        body: '<!-- OTHER-MARKER -->\n\nOther comment'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: mockComments
    })

    const result = await findExistingComments(mockContext, 123)

    expect(result).toHaveLength(0)
  })

  it('should return empty array when no comments exist', async () => {
    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: []
    })

    const result = await findExistingComments(mockContext, 123)

    expect(result).toHaveLength(0)
  })
})

describe('findExistingSummaryComment', () => {
  let mockContext: Context
  let mockOctokit: {
    issues: {
      listComments: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    mockOctokit = {
      issues: {
        listComments: vi.fn()
      }
    }

    mockContext = {
      octokit: mockOctokit,
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  it('should find comment with summary marker', async () => {
    const mockComments = [
      {
        id: 1,
        body: 'Regular comment'
      },
      {
        id: 2,
        body: `${SUMMARY_MARKER}\n\nThis is the summary comment`
      },
      {
        id: 3,
        body: 'Another regular comment'
      }
    ]

    mockOctokit.issues.listComments.mockResolvedValue({
      data: mockComments
    })

    const result = await findExistingSummaryComment(mockContext, 123)

    expect(mockOctokit.issues.listComments).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 123
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe(2)
  })

  it('should return undefined when no summary comment exists', async () => {
    const mockComments = [
      {
        id: 1,
        body: 'Regular comment'
      },
      {
        id: 2,
        body: '<!-- OTHER-MARKER -->\n\nOther comment'
      }
    ]

    mockOctokit.issues.listComments.mockResolvedValue({
      data: mockComments
    })

    const result = await findExistingSummaryComment(mockContext, 123)

    expect(result).toBeUndefined()
  })

  it('should return undefined when no comments exist', async () => {
    mockOctokit.issues.listComments.mockResolvedValue({
      data: []
    })

    const result = await findExistingSummaryComment(mockContext, 123)

    expect(result).toBeUndefined()
  })
})

describe('checkCommentExistence', () => {
  let mockContext: Context
  let mockOctokit: {
    pulls: {
      getReviewComment: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    mockOctokit = {
      pulls: {
        getReviewComment: vi.fn()
      }
    }

    mockContext = {
      octokit: mockOctokit,
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  it('should return exists: true when comment exists', async () => {
    mockOctokit.pulls.getReviewComment.mockResolvedValue({
      data: { id: 123, body: 'Comment exists' }
    })

    const result = await checkCommentExistence(mockContext, 123)

    expect(mockOctokit.pulls.getReviewComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 123
    })

    expect(result).toEqual({ exists: true })
  })

  it('should return exists: false with not_found reason for 404 error', async () => {
    const error = {
      status: 404,
      message: 'Not Found'
    }

    mockOctokit.pulls.getReviewComment.mockRejectedValue(error)

    const result = await checkCommentExistence(mockContext, 123)

    expect(result).toEqual({
      exists: false,
      reason: 'not_found'
    })
  })

  it('should return exists: false with error reason for non-404 GitHub API error', async () => {
    const error = {
      status: 500,
      message: 'Internal Server Error'
    }

    mockOctokit.pulls.getReviewComment.mockRejectedValue(error)

    const result = await checkCommentExistence(mockContext, 123)

    expect(result).toEqual({
      exists: false,
      reason: 'error',
      error
    })
  })

  it('should return exists: false with error reason for non-GitHub error', async () => {
    const error = new Error('Network error')

    mockOctokit.pulls.getReviewComment.mockRejectedValue(error)

    const result = await checkCommentExistence(mockContext, 123)

    expect(result).toEqual({
      exists: false,
      reason: 'error',
      error
    })
  })
})

describe('createCommentParams', () => {
  let mockContext: Context

  beforeEach(() => {
    mockContext = {
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  const prNumber = 123
  const commitSha = 'abc123'

  it('should create params for single-line comment', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'Single line comment'
    }
    const commentBody =
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nSingle line comment'

    const result = createCommentParams(
      mockContext.repo(),
      prNumber,
      commitSha,
      comment,
      commentBody
    )

    expect(result).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
      commit_id: 'abc123',
      path: 'src/file.ts',
      line: 10,
      body: commentBody
    })
  })

  it('should create params for multi-line comment', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      body: 'Multi-line comment'
    }
    const commentBody =
      '<!-- REVU-AI-COMMENT src_file.ts:10-15 -->\n\nMulti-line comment'

    const result = createCommentParams(
      mockContext.repo(),
      prNumber,
      commitSha,
      comment,
      commentBody
    )

    expect(result).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
      commit_id: 'abc123',
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      side: 'RIGHT',
      start_side: 'RIGHT',
      body: commentBody
    })
  })

  it('should handle edge case where start_line equals line', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      start_line: 10,
      body: 'Single line range'
    }
    const commentBody =
      '<!-- REVU-AI-COMMENT src_file.ts:10-10 -->\n\nSingle line range'

    const result = createCommentParams(
      mockContext.repo(),
      prNumber,
      commitSha,
      comment,
      commentBody
    )

    expect(result).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
      commit_id: 'abc123',
      path: 'src/file.ts',
      line: 10,
      start_line: 10,
      side: 'RIGHT',
      start_side: 'RIGHT',
      body: commentBody
    })
  })
})

describe('cleanupObsoleteComments', () => {
  let mockContext: Context
  let mockOctokit: {
    pulls: {
      listReviewComments: ReturnType<typeof vi.fn>
      deleteReviewComment: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    mockOctokit = {
      pulls: {
        listReviewComments: vi.fn(),
        deleteReviewComment: vi.fn()
      }
    }

    mockContext = {
      octokit: mockOctokit,
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  it('should delete comments on lines no longer in diff', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nObsolete comment',
        path: 'file1.ts'
      },
      {
        id: 2,
        body: '<!-- REVU-AI-COMMENT file2.ts:20 -->\n\nStill relevant',
        path: 'file2.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    const diffMap = new Map([
      ['file2.ts', { changedLines: new Set([20, 21]) }]
      // file1.ts is not in the current diff
    ])

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledTimes(1)
    expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 1
    })

    expect(result).toBe(1)
  })

  it('should delete multi-line comments when range is no longer in diff', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:10-15 -->\n\nMulti-line comment',
        path: 'file1.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    const diffMap = new Map([
      ['file1.ts', { changedLines: new Set([10, 11, 12]) }] // Missing lines 13, 14, 15
    ])

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 1
    })

    expect(result).toBe(1)
  })

  it('should preserve comments that are still relevant', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nStill relevant',
        path: 'file1.ts'
      },
      {
        id: 2,
        body: '<!-- REVU-AI-COMMENT file1.ts:15-20 -->\n\nMulti-line still relevant',
        path: 'file1.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    const diffMap = new Map([
      ['file1.ts', { changedLines: new Set([10, 11, 15, 16, 17, 18, 19, 20]) }]
    ])

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  it('should skip comments without valid marker format', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT -->\n\nMalformed marker',
        path: 'file1.ts'
      },
      {
        id: 2,
        body: 'Regular comment without marker',
        path: 'file1.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    const diffMap = new Map()

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  it('should handle deletion errors gracefully', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nComment to delete',
        path: 'file1.ts'
      },
      {
        id: 2,
        body: '<!-- REVU-AI-COMMENT file2.ts:20 -->\n\nAnother comment to delete',
        path: 'file2.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    // Mock first deletion to fail, second to succeed
    mockOctokit.pulls.deleteReviewComment
      .mockRejectedValueOnce(new Error('API Error'))
      .mockResolvedValueOnce({})

    const diffMap = new Map() // Empty diff means all comments should be deleted

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledTimes(2)
    expect(result).toBe(1) // Only one successful deletion
  })

  it('should handle invalid line number parsing', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:invalid -->\n\nInvalid line number',
        path: 'file1.ts'
      },
      {
        id: 2,
        body: '<!-- REVU-AI-COMMENT file1.ts:10-invalid -->\n\nInvalid range',
        path: 'file1.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    const diffMap = new Map()

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  it('should handle empty diff map', async () => {
    const existingComments = [
      {
        id: 1,
        body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nComment',
        path: 'file1.ts'
      }
    ]

    mockOctokit.pulls.listReviewComments.mockResolvedValue({
      data: existingComments
    })

    const diffMap = new Map()

    const result = await cleanupObsoleteComments(mockContext, 123, diffMap)

    expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 1
    })

    expect(result).toBe(1)
  })
})
