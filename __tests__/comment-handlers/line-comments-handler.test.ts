import { describe, expect, it, vi, beforeEach } from 'vitest'
import { type Context } from 'probot'
import { lineCommentsHandler } from '../../src/comment-handlers/line-comments-handler.ts'

// Mock fetchPrDiff - function must be defined before vi.mock call
vi.mock('../../src/extract-diff.ts', () => ({
  fetchPrDiff: vi.fn()
}))

// Mock global comment handler
vi.mock('../../src/comment-handlers/global-comment-handler.ts', () => ({
  globalCommentHandler: vi.fn(),
  upsertComment: vi.fn().mockResolvedValue('Upserted comment')
}))

// Import the mocked functions after the mock setup
import { fetchPrDiff } from '../../src/extract-diff.ts'
import { globalCommentHandler } from '../../src/comment-handlers/global-comment-handler.ts'

const mockFetchPrDiff = vi.mocked(fetchPrDiff)
const mockGlobalCommentHandler = vi.mocked(globalCommentHandler)

describe('lineCommentsHandler', () => {
  let mockContext: Context
  let mockOctokit: {
    pulls: {
      listReviewComments: ReturnType<typeof vi.fn>
      updateReviewComment: ReturnType<typeof vi.fn>
      createReviewComment: ReturnType<typeof vi.fn>
      deleteReviewComment: ReturnType<typeof vi.fn>
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

    it('should fallback to global handler on invalid JSON', async () => {
      const invalidJson = 'invalid json'

      await lineCommentsHandler(mockContext, 123, invalidJson)

      expect(mockGlobalCommentHandler).toHaveBeenCalledWith(
        mockContext,
        123,
        invalidJson
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
})
