import { type Context } from 'probot'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lineCommentsHandler } from '../../src/comment-handlers/line-comments-handler.ts'

// Mock fetchPrDiff - function must be defined before vi.mock call
vi.mock('../../src/extract-diff.ts', () => ({
  fetchPrDiffFileMap: vi.fn()
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
import { errorCommentHandler } from '../../src/comment-handlers/error-comment-handler.ts'
import { fetchPrDiffFileMap } from '../../src/extract-diff.ts'

const mockFetchPrDiffFileMap = vi.mocked(fetchPrDiffFileMap)
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

  describe('Integration Tests', () => {
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
      // Setup default mocks for integration tests
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

      mockFetchPrDiffFileMap.mockResolvedValue(
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

      mockFetchPrDiffFileMap.mockResolvedValue(
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

      mockFetchPrDiffFileMap.mockResolvedValue(
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

  describe('Multi-line Comments Integration', () => {
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
      mockFetchPrDiffFileMap.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12, 13, 14, 15]) }],
          ['file2.ts', { changedLines: new Set([20, 21]) }]
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

      expect(result).toContain('Created 2')
    })

    it('should skip multi-line comment when entire range is not in diff', async () => {
      // Mock diff that only includes some lines from the range
      mockFetchPrDiffFileMap.mockResolvedValue(
        new Map([
          ['file1.ts', { changedLines: new Set([10, 11, 12]) }], // Missing lines 13, 14, 15
          ['file2.ts', { changedLines: new Set([20, 21]) }]
        ])
      )

      const result = await lineCommentsHandler(
        mockContext,
        123,
        multiLineAnalysisJson
      )

      // Should skip the multi-line comment on file1.ts since not all lines are in diff
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledTimes(1) // Only file2.ts
      expect(result).toContain('skipped 1')
    })
  })

  describe('Error Handling Integration', () => {
    beforeEach(() => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } }
      })

      mockOctokit.issues.listComments.mockResolvedValue({
        data: []
      })

      mockFetchPrDiffFileMap.mockResolvedValue(
        new Map([['file1.ts', { changedLines: new Set([10, 11]) }]])
      )
    })

    it('should skip comment when comment existence check fails with non-404 error', async () => {
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

    it('should handle validation errors and fallback to error handler', async () => {
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
  })
})
