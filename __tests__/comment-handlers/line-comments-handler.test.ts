import { describe, expect, it, vi, beforeEach } from 'vitest'
import { type Context } from 'probot'
import { lineCommentsHandler } from '../../src/comment-handlers/line-comments-handler.ts'

// Mock fetchPrDiff - function must be defined before vi.mock call
vi.mock('../../src/extract-diff.ts', () => ({
  fetchPrDiff: vi.fn()
}))

// Mock global comment handler and error comment handler
vi.mock('../../src/comment-handlers/global-comment-handler.ts', () => ({
  globalCommentHandler: vi.fn(),
  upsertComment: vi.fn().mockResolvedValue('Upserted comment')
}))

vi.mock('../../src/comment-handlers/error-comment-handler.ts', () => ({
  errorCommentHandler: vi.fn().mockResolvedValue('Posted error comment')
}))

// Import the mocked functions after the mock setup
import { fetchPrDiff } from '../../src/extract-diff.ts'
import { errorCommentHandler } from '../../src/comment-handlers/error-comment-handler.ts'

const mockFetchPrDiff = vi.mocked(fetchPrDiff)
const mockErrorCommentHandler = vi.mocked(errorCommentHandler)

describe('lineCommentsHandler', () => {
  let mockContext: Context
  let mockOctokit: {
    pulls: {
      listReviewComments: ReturnType<typeof vi.fn>
      updateReviewComment: ReturnType<typeof vi.fn>
      createReviewComment: ReturnType<typeof vi.fn>
      deleteReviewComment: ReturnType<typeof vi.fn>
      getReviewComment: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }
    issues: {
      listComments: ReturnType<typeof vi.fn>
      updateComment: ReturnType<typeof vi.fn>
      createComment: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Setup mock octokit
    mockOctokit = {
      pulls: {
        listReviewComments: vi.fn(),
        updateReviewComment: vi.fn(),
        createReviewComment: vi.fn(),
        deleteReviewComment: vi.fn(),
        getReviewComment: vi.fn(),
        get: vi.fn()
      },
      issues: {
        listComments: vi.fn(),
        updateComment: vi.fn(),
        createComment: vi.fn()
      }
    }

    // Setup mock context
    mockContext = {
      octokit: mockOctokit,
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
    } as unknown as Context
  })

  describe('Current Behavior (Regression Tests)', () => {
    const validAnalysisJson = JSON.stringify({
      summary: 'Test summary',
      comments: [
        {
          path: 'file1.ts',
          line: 10,
          body: 'Test comment',
          suggestion: 'console.log("fixed")'
        },
        {
          path: 'file2.ts',
          line: 20,
          body: 'Another comment'
        }
      ]
    })

    beforeEach(() => {
      // Setup default mocks for current behavior
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: []
      })

      // Mock getReviewComment to return success by default (comment exists)
      mockOctokit.pulls.getReviewComment.mockResolvedValue({
        data: { id: 1, body: 'Existing comment' }
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11]) }],
          ['file2.ts', { changedLines: new Set([20, 21]) }]
        ])
      )
    })

    it('should create new comments when none exist', async () => {
      const result = await lineCommentsHandler(
        mockContext,
        123,
        validAnalysisJson
      )

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledTimes(2)
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        commit_id: 'abc123',
        path: 'file1.ts',
        line: 10,
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file1.ts:10 -->')
      })
      expect(result).toContain('Created 2')
    })

    it('should update existing comments with same markerId', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nOld comment',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      const result = await lineCommentsHandler(
        mockContext,
        123,
        validAnalysisJson
      )

      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1,
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file1.ts:10 -->')
      })
      expect(result).toContain('updated 1')
    })

    it('should skip comments on lines not in diff', async () => {
      const analysisWithLineNotInDiff = JSON.stringify({
        summary: 'Test summary',
        comments: [
          {
            path: 'file1.ts',
            line: 99, // This line is not in the diff
            body: 'Comment on line not in diff'
          }
        ]
      })

      const result = await lineCommentsHandler(
        mockContext,
        123,
        analysisWithLineNotInDiff
      )

      expect(mockOctokit.pulls.createReviewComment).not.toHaveBeenCalled()
      expect(result).toContain('skipped 1')
    })

    it('should create summary comment', async () => {
      const result = await lineCommentsHandler(
        mockContext,
        123,
        validAnalysisJson
      )

      expect(mockOctokit.issues.listComments).toHaveBeenCalled()
      expect(result).toBeDefined()
      // upsertComment should be called for summary
    })

    it('should fallback to error handler on invalid JSON', async () => {
      const invalidJson = 'invalid json'

      await lineCommentsHandler(mockContext, 123, invalidJson)

      expect(mockErrorCommentHandler).toHaveBeenCalledWith(
        mockContext,
        123,
        expect.stringContaining('Error processing line comments:')
      )
    })

    it('should handle suggestions in comments', async () => {
      const result = await lineCommentsHandler(
        mockContext,
        123,
        validAnalysisJson
      )

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '```suggestion\nconsole.log("fixed")\n```'
          )
        })
      )
      expect(result).toBeDefined()
    })
  })

  describe('Cleanup Behavior (New Feature)', () => {
    const analysisWithCurrentComments = JSON.stringify({
      summary: 'Updated summary',
      comments: [
        {
          path: 'file2.ts',
          line: 20,
          body: 'Still relevant comment'
        },
        {
          path: 'file3.ts',
          line: 30,
          body: 'New comment'
        }
      ]
    })

    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })
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

      // Current diff only contains file2.ts:20 and file3.ts:30
      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file2.ts', { changedLines: new Set([20, 21]) }],
          ['file3.ts', { changedLines: new Set([30, 31]) }]
        ])
      )

      const result = await lineCommentsHandler(
        mockContext,
        123,
        analysisWithCurrentComments
      )

      // Should delete the obsolete comment on file1.ts:10
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
      })

      expect(result).toContain('deleted 1')
    })

    it('should preserve comments still relevant in current diff', async () => {
      const existingComments = [
        {
          id: 2,
          body: '<!-- REVU-AI-COMMENT file2.ts:20 -->\n\nStill relevant',
          path: 'file2.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file2.ts', { changedLines: new Set([20, 21]) }],
          ['file3.ts', { changedLines: new Set([30, 31]) }]
        ])
      )

      const result = await lineCommentsHandler(
        mockContext,
        123,
        analysisWithCurrentComments
      )

      // Should NOT delete the still relevant comment
      expect(mockOctokit.pulls.deleteReviewComment).not.toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 2
      })

      // Should update it instead
      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 2,
        body: expect.stringContaining('Still relevant comment')
      })
      expect(result).toBeDefined()
    })

    it('should handle mixed scenario: delete obsolete + update existing + create new', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nObsolete comment',
          path: 'file1.ts'
        },
        {
          id: 2,
          body: '<!-- REVU-AI-COMMENT file2.ts:20 -->\n\nTo be updated',
          path: 'file2.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file2.ts', { changedLines: new Set([20, 21]) }],
          ['file3.ts', { changedLines: new Set([30, 31]) }]
        ])
      )

      const result = await lineCommentsHandler(
        mockContext,
        123,
        analysisWithCurrentComments
      )

      // Should delete obsolete
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
      })

      // Should update existing
      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 2,
        body: expect.stringContaining('Still relevant comment')
      })

      // Should create new
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        commit_id: 'abc123',
        path: 'file3.ts',
        line: 30,
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file3.ts:30 -->')
      })

      expect(result).toMatch(/Created 1.*updated 1.*deleted 1/s)
    })

    it('should not delete comments from other bots/users', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nOur obsolete comment',
          path: 'file1.ts'
        },
        {
          id: 2,
          body: 'Regular comment without our marker',
          path: 'file1.ts'
        },
        {
          id: 3,
          body: '<!-- OTHER-BOT-MARKER -->\n\nOther bot comment',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([['file2.ts', { changedLines: new Set([20]) }]])
      )

      await lineCommentsHandler(mockContext, 123, analysisWithCurrentComments)

      // Should only delete our comment
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledTimes(1)
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
      })
    })

    it('should handle empty diff (delete all our comments)', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nComment 1',
          path: 'file1.ts'
        },
        {
          id: 2,
          body: '<!-- REVU-AI-COMMENT file2.ts:20 -->\n\nComment 2',
          path: 'file2.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Empty diff - no changed lines
      mockFetchPrDiff.mockResolvedValue(new Map())

      const emptyAnalysis = JSON.stringify({
        summary: 'No changes',
        comments: []
      })

      const result = await lineCommentsHandler(mockContext, 123, emptyAnalysis)

      // Should delete both our comments
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledTimes(2)
      expect(result).toContain('deleted 2')
    })

    it('should handle GitHub API errors during deletion gracefully', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nComment to delete',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([['file2.ts', { changedLines: new Set([20]) }]])
      )

      // Mock deletion failure
      mockOctokit.pulls.deleteReviewComment.mockRejectedValue(
        new Error('GitHub API Error')
      )

      const result = await lineCommentsHandler(
        mockContext,
        123,
        analysisWithCurrentComments
      )

      // Should continue processing despite deletion error
      expect(result).toBeDefined()
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalled()
    })
  })

  describe('Integration Tests', () => {
    it('should perform cleanup then normal processing in correct order', async () => {
      const calls: string[] = []

      // Track the order of API calls
      mockOctokit.pulls.deleteReviewComment.mockImplementation(() => {
        calls.push('delete')
        return Promise.resolve()
      })

      mockOctokit.pulls.updateReviewComment.mockImplementation(() => {
        calls.push('update')
        return Promise.resolve()
      })

      mockOctokit.pulls.createReviewComment.mockImplementation(() => {
        calls.push('create')
        return Promise.resolve()
      })

      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nObsolete',
          path: 'file1.ts'
        },
        {
          id: 2,
          body: '<!-- REVU-AI-COMMENT file2.ts:20 -->\n\nTo update',
          path: 'file2.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file2.ts', { changedLines: new Set([20]) }],
          ['file3.ts', { changedLines: new Set([30]) }]
        ])
      )

      const analysis = JSON.stringify({
        summary: 'Test',
        comments: [
          { path: 'file2.ts', line: 20, body: 'Updated comment' },
          { path: 'file3.ts', line: 30, body: 'New comment' }
        ]
      })

      await lineCommentsHandler(mockContext, 123, analysis)

      // Verify order: delete operations should happen before create/update
      const deleteIndex = calls.findIndex((call) => call === 'delete')
      const updateIndex = calls.findIndex((call) => call === 'update')
      const createIndex = calls.findIndex((call) => call === 'create')

      expect(deleteIndex).toBeLessThan(updateIndex)
      expect(deleteIndex).toBeLessThan(createIndex)
    })

    it('should return accurate counts including deletions', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nObsolete',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([['file2.ts', { changedLines: new Set([20]) }]])
      )

      const analysis = JSON.stringify({
        summary: 'Test',
        comments: [{ path: 'file2.ts', line: 20, body: 'New comment' }]
      })

      const result = await lineCommentsHandler(mockContext, 123, analysis)

      expect(result).toContain('deleted 1')
      expect(result).toContain('Created 1')
      expect(result).toContain('updated 0')
      expect(result).toContain('skipped 0')
    })
  })

  describe('Multi-line Comments Support', () => {
    const multiLineAnalysisJson = JSON.stringify({
      summary: 'Test with multi-line comments',
      comments: [
        {
          path: 'file1.ts',
          line: 15,
          start_line: 10,
          body: 'Multi-line comment spanning lines 10-15',
          suggestion: 'const result = doSomething()'
        },
        {
          path: 'file2.ts',
          line: 20,
          body: 'Single-line comment on line 20'
        },
        {
          path: 'file3.ts',
          line: 25,
          start_line: 25,
          body: 'Edge case: start_line equals line'
        }
      ]
    })

    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: []
      })

      // Mock diff that includes all lines in the ranges
      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12, 13, 14, 15]) }],
          ['file2.ts', { changedLines: new Set([20, 21]) }],
          ['file3.ts', { changedLines: new Set([25, 26]) }]
        ])
      )
    })

    it('should create multi-line comment when start_line is provided', async () => {
      const result = await lineCommentsHandler(
        mockContext,
        123,
        multiLineAnalysisJson
      )

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        commit_id: 'abc123',
        path: 'file1.ts',
        line: 15,
        start_line: 10,
        side: 'RIGHT',
        start_side: 'RIGHT',
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file1.ts:10-15 -->')
      })

      expect(result).toContain('Created 3')
    })

    it('should create single-line comment when start_line is not provided', async () => {
      await lineCommentsHandler(mockContext, 123, multiLineAnalysisJson)

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        commit_id: 'abc123',
        path: 'file2.ts',
        line: 20,
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file2.ts:20 -->')
      })

      // Should NOT include start_line, side, start_side for single-line
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.not.objectContaining({
          start_line: expect.anything(),
          side: expect.anything(),
          start_side: expect.anything()
        })
      )
    })

    it('should handle edge case where start_line equals line', async () => {
      await lineCommentsHandler(mockContext, 123, multiLineAnalysisJson)

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        commit_id: 'abc123',
        path: 'file3.ts',
        line: 25,
        start_line: 25,
        side: 'RIGHT',
        start_side: 'RIGHT',
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file3.ts:25-25 -->')
      })
    })

    it('should update existing multi-line comment with same markerId', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10-15 -->\n\nOld multi-line comment',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      const result = await lineCommentsHandler(
        mockContext,
        123,
        multiLineAnalysisJson
      )

      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1,
        body: expect.stringContaining('<!-- REVU-AI-COMMENT file1.ts:10-15 -->')
      })
      expect(result).toContain('updated 1')
    })

    it('should handle suggestions in multi-line comments', async () => {
      await lineCommentsHandler(mockContext, 123, multiLineAnalysisJson)

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'file1.ts',
          body: expect.stringContaining(
            '```suggestion\nconst result = doSomething()\n```'
          )
        })
      )
    })

    it('should skip multi-line comment when entire range is not in diff', async () => {
      // Mock diff that only includes some lines from the range
      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12]) }], // Missing lines 13, 14, 15
          ['file2.ts', { changedLines: new Set([20, 21]) }],
          ['file3.ts', { changedLines: new Set([25, 26]) }]
        ])
      )

      const result = await lineCommentsHandler(
        mockContext,
        123,
        multiLineAnalysisJson
      )

      // Should skip the multi-line comment on file1.ts since not all lines are in diff
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledTimes(2) // Only file2.ts and file3.ts
      expect(result).toContain('skipped 1')
    })
  })

  describe('Multi-line Comments Validation', () => {
    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12, 13, 14, 15]) }]
        ])
      )
    })

    it('should reject when start_line is greater than line', async () => {
      const invalidAnalysis = JSON.stringify({
        summary: 'Invalid multi-line comment',
        comments: [
          {
            path: 'file1.ts',
            line: 10,
            start_line: 15, // Invalid: start_line > line
            body: 'Invalid range'
          }
        ]
      })

      await lineCommentsHandler(mockContext, 123, invalidAnalysis)

      expect(mockErrorCommentHandler).toHaveBeenCalledWith(
        mockContext,
        123,
        expect.stringContaining('Error processing line comments:')
      )
    })

    it('should validate negative line numbers', async () => {
      const invalidAnalysis = JSON.stringify({
        summary: 'Invalid line numbers',
        comments: [
          {
            path: 'file1.ts',
            line: -5,
            start_line: -10,
            body: 'Negative lines'
          }
        ]
      })

      await lineCommentsHandler(mockContext, 123, invalidAnalysis)

      expect(mockErrorCommentHandler).toHaveBeenCalledWith(
        mockContext,
        123,
        expect.stringContaining('Error processing line comments:')
      )
    })
  })

  describe('Multi-line Comments Cleanup', () => {
    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })
    })

    it('should delete multi-line comment when entire range is no longer in diff', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10-15 -->\n\nObsolete multi-line comment',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Current diff doesn't include the range 10-15
      mockFetchPrDiff.mockResolvedValue(
        new Map([['file2.ts', { changedLines: new Set([20, 21]) }]])
      )

      const analysis = JSON.stringify({
        summary: 'Updated',
        comments: []
      })

      const result = await lineCommentsHandler(mockContext, 123, analysis)

      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
      })
      expect(result).toContain('deleted 1')
    })

    it('should delete multi-line comment when partial range is missing from diff', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10-15 -->\n\nPartially obsolete comment',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Current diff only includes part of the range
      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12]) }] // Missing 13, 14, 15
        ])
      )

      const analysis = JSON.stringify({
        summary: 'Updated',
        comments: []
      })

      const result = await lineCommentsHandler(mockContext, 123, analysis)

      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
      })
      expect(result).toContain('deleted 1')
    })

    it('should preserve multi-line comment when entire range is still in diff', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10-15 -->\n\nStill relevant multi-line',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Current diff includes the entire range
      mockFetchPrDiff.mockResolvedValue(
        new Map([
          [
            'file1.ts',
            { changedLines: new Set([10, 11, 12, 13, 14, 15, 16, 17]) }
          ]
        ])
      )

      const analysis = JSON.stringify({
        summary: 'Updated',
        comments: [
          {
            path: 'file1.ts',
            line: 15,
            start_line: 10,
            body: 'Updated multi-line comment'
          }
        ]
      })

      await lineCommentsHandler(mockContext, 123, analysis)

      expect(mockOctokit.pulls.deleteReviewComment).not.toHaveBeenCalled()
      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1,
        body: expect.stringContaining('Updated multi-line comment')
      })
    })

    it('should handle mixed single-line and multi-line comments cleanup', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nSingle-line comment',
          path: 'file1.ts'
        },
        {
          id: 2,
          body: '<!-- REVU-AI-COMMENT file2.ts:20-25 -->\n\nMulti-line comment',
          path: 'file2.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Only file1.ts:10 is still in diff, file2.ts:20-25 is not
      mockFetchPrDiff.mockResolvedValue(
        new Map([['file1.ts', { changedLines: new Set([10, 11]) }]])
      )

      const analysis = JSON.stringify({
        summary: 'Updated',
        comments: [
          {
            path: 'file1.ts',
            line: 10,
            body: 'Updated single-line comment'
          }
        ]
      })

      await lineCommentsHandler(mockContext, 123, analysis)

      // Should delete the multi-line comment but preserve single-line
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledTimes(1)
      expect(mockOctokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 2
      })

      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1,
        body: expect.stringContaining('Updated single-line comment')
      })
    })
  })

  describe('Multi-line Comment Markers', () => {
    it('should create correct markerId for single-line comment', async () => {
      const singleLineAnalysis = JSON.stringify({
        summary: 'Single line test',
        comments: [
          {
            path: 'file1.ts',
            line: 10,
            body: 'Single line comment'
          }
        ]
      })

      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([['file1.ts', { changedLines: new Set([10]) }]])
      )

      await lineCommentsHandler(mockContext, 123, singleLineAnalysis)

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('<!-- REVU-AI-COMMENT file1.ts:10 -->')
        })
      )
    })

    it('should create correct markerId for multi-line comment', async () => {
      const multiLineAnalysis = JSON.stringify({
        summary: 'Multi-line test',
        comments: [
          {
            path: 'file1.ts',
            line: 15,
            start_line: 10,
            body: 'Multi-line comment'
          }
        ]
      })

      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12, 13, 14, 15]) }]
        ])
      )

      await lineCommentsHandler(mockContext, 123, multiLineAnalysis)

      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '<!-- REVU-AI-COMMENT file1.ts:10-15 -->'
          )
        })
      )
    })

    it('should handle special characters in file paths for markerId', async () => {
      const specialPathAnalysis = JSON.stringify({
        summary: 'Special path test',
        comments: [
          {
            path: 'src/components/my-component.tsx',
            line: 15,
            start_line: 10,
            body: 'Comment on special path'
          }
        ]
      })

      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([
          [
            'src/components/my-component.tsx',
            { changedLines: new Set([10, 11, 12, 13, 14, 15]) }
          ]
        ])
      )

      await lineCommentsHandler(mockContext, 123, specialPathAnalysis)

      // Should sanitize special characters in markerId
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining(
            '<!-- REVU-AI-COMMENT src_components_my-component.tsx:10-15 -->'
          )
        })
      )
    })
  })

  describe('Error Handling Robustness', () => {
    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiff.mockResolvedValue(
        new Map([['file1.ts', { changedLines: new Set([10, 11]) }]])
      )
    })

    it('should skip comment when commentStillExists throws non-404 error', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nExisting comment',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Mock getReviewComment to throw a non-404 error (e.g., rate limiting)
      mockOctokit.pulls.getReviewComment.mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded'
      })

      const analysis = JSON.stringify({
        summary: 'Test with API error',
        comments: [
          {
            path: 'file1.ts',
            line: 10,
            body: 'Updated comment'
          }
        ]
      })

      const result = await lineCommentsHandler(mockContext, 123, analysis)

      // Should skip the update due to API error
      expect(mockOctokit.pulls.updateReviewComment).not.toHaveBeenCalled()
      expect(mockOctokit.pulls.createReviewComment).not.toHaveBeenCalled()
      expect(result).toContain('skipped 1')
    })

    it('should continue processing other comments when one comment verification fails', async () => {
      const existingComments = [
        {
          id: 1,
          body: '<!-- REVU-AI-COMMENT file1.ts:10 -->\n\nComment with API error',
          path: 'file1.ts'
        },
        {
          id: 2,
          body: '<!-- REVU-AI-COMMENT file1.ts:11 -->\n\nComment that works',
          path: 'file1.ts'
        }
      ]

      mockOctokit.pulls.listReviewComments.mockResolvedValue({
        data: existingComments
      })

      // Mock getReviewComment to fail for first comment but succeed for second
      mockOctokit.pulls.getReviewComment
        .mockRejectedValueOnce({
          status: 500,
          message: 'Internal server error'
        })
        .mockResolvedValueOnce({
          data: { id: 2, body: 'Existing comment' }
        })

      mockFetchPrDiff.mockResolvedValue(
        new Map([['file1.ts', { changedLines: new Set([10, 11]) }]])
      )

      const analysis = JSON.stringify({
        summary: 'Test with mixed API responses',
        comments: [
          {
            path: 'file1.ts',
            line: 10,
            body: 'Updated comment 1'
          },
          {
            path: 'file1.ts',
            line: 11,
            body: 'Updated comment 2'
          }
        ]
      })

      const result = await lineCommentsHandler(mockContext, 123, analysis)

      // First comment should be skipped, second should be updated
      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledTimes(1)
      expect(mockOctokit.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 2,
        body: expect.stringContaining('Updated comment 2')
      })
      expect(result).toContain('updated 1')
      expect(result).toContain('skipped 1')
    })
  })
})
