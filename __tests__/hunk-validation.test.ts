import { describe, expect, it } from 'vitest'
import {
  areInSameHunk,
  constrainCommentToHunk,
  findHunkForLine,
  isCommentValidForDiff
} from '../src/comment-handlers/comment-utils.ts'
import type { Comment } from '../src/comment-handlers/types.ts'
import type { DiffHunk } from '../src/core/models/diff-types.ts'

describe('Hunk Validation Functions', () => {
  const sampleHunks: DiffHunk[] = [
    {
      startLine: 10,
      endLine: 15,
      header: '@@ -10,6 +10,6 @@'
    },
    {
      startLine: 25,
      endLine: 30,
      header: '@@ -25,6 +25,6 @@'
    },
    {
      startLine: 50,
      endLine: 55,
      header: '@@ -50,6 +50,6 @@'
    }
  ]

  describe('findHunkForLine', () => {
    it('should find the correct hunk for a line within range', () => {
      const hunk = findHunkForLine(sampleHunks, 12)
      expect(hunk).toEqual(sampleHunks[0])
    })

    it('should find the correct hunk for boundary lines', () => {
      const startHunk = findHunkForLine(sampleHunks, 10)
      const endHunk = findHunkForLine(sampleHunks, 15)
      expect(startHunk).toEqual(endHunk)
    })

    it('should return null for lines outside any hunk', () => {
      const hunk = findHunkForLine(sampleHunks, 20)
      expect(hunk).toBeNull()
    })

    it('should handle empty hunks array', () => {
      const hunk = findHunkForLine([], 10)
      expect(hunk).toBeNull()
    })
  })

  describe('areInSameHunk', () => {
    it('should return true for lines in the same hunk', () => {
      const result = areInSameHunk(sampleHunks, 12, 14)
      expect(result).toBe(true)
    })

    it('should return false for lines in different hunks', () => {
      const result = areInSameHunk(sampleHunks, 12, 27)
      expect(result).toBe(false)
    })

    it('should return false when one line is not in any hunk', () => {
      const result = areInSameHunk(sampleHunks, 12, 20)
      expect(result).toBe(false)
    })

    it('should return false when both lines are not in any hunk', () => {
      const result = areInSameHunk(sampleHunks, 20, 22)
      expect(result).toBe(false)
    })
  })

  describe('constrainCommentToHunk', () => {
    it('should return original comment when it fits within a single hunk', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 14,
        start_line: 12,
        body: 'Valid comment'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toEqual(comment)
    })

    it('should move comment to first line of first overlapping hunk when spanning multiple hunks', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 27,
        start_line: 12, // Starts in first hunk, ends in second hunk
        body: 'Spanning comment'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toEqual({
        ...comment,
        start_line: undefined, // Converted to single-line comment
        line: 10 // Moved to first line of first hunk
      })
    })

    it('should move comment to first line of first overlapping hunk when end is outside', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 20, // Outside any hunk
        start_line: 12, // In first hunk
        body: 'Partially valid comment'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toEqual({
        ...comment,
        start_line: undefined, // Converted to single-line comment
        line: 10 // Moved to first line of first overlapping hunk
      })
    })

    it('should fall back to single line comment when multi-line cannot be constrained', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 20, // Outside any hunk
        start_line: 18, // Also outside any hunk
        body: 'Invalid range comment'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toBeNull()
    })

    it('should handle single line comments', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 12,
        body: 'Single line comment'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toEqual(comment)
    })

    it('should return null for single line comment outside any hunk', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 20,
        body: 'Invalid single line comment'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toBeNull()
    })

    it('should handle comment that overlaps with multiple hunks and choose the first one', () => {
      const comment: Comment = {
        path: 'test.ts',
        start_line: 14, // In first hunk
        line: 52, // In third hunk
        body: 'Comment spanning first and third hunks'
      }

      const result = constrainCommentToHunk(comment, sampleHunks)
      expect(result).toEqual({
        ...comment,
        line: 10, // First line of first hunk (startLine: 10)
        start_line: undefined // Converted to single-line comment
      })
    })
  })

  describe('isCommentValidForDiff with hunk validation', () => {
    const createDiffMapWithHunks = (
      changedLines: number[],
      hunks: DiffHunk[]
    ) => {
      const diffMap = new Map()
      diffMap.set('test.ts', {
        changedLines: new Set(changedLines),
        hunks
      })
      return diffMap
    }

    it('should validate single line comment in hunk', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 12,
        body: 'Valid comment'
      }

      const diffMap = createDiffMapWithHunks(
        [10, 11, 12, 13, 14, 15],
        sampleHunks
      )
      expect(isCommentValidForDiff(comment, diffMap)).toBe(true)
    })

    it('should reject single line comment outside hunk', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 20,
        body: 'Invalid comment'
      }

      const diffMap = createDiffMapWithHunks(
        [10, 11, 12, 13, 14, 15],
        sampleHunks
      )
      expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
    })

    it('should validate multi-line comment within same hunk', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 14,
        start_line: 12,
        body: 'Valid multi-line comment'
      }

      const diffMap = createDiffMapWithHunks(
        [10, 11, 12, 13, 14, 15],
        sampleHunks
      )
      expect(isCommentValidForDiff(comment, diffMap)).toBe(true)
    })

    it('should reject multi-line comment spanning different hunks', () => {
      const comment: Comment = {
        path: 'test.ts',
        line: 27,
        start_line: 12, // First hunk to second hunk
        body: 'Invalid spanning comment'
      }

      const diffMap = createDiffMapWithHunks(
        [10, 11, 12, 13, 14, 15, 25, 26, 27, 28, 29, 30],
        sampleHunks
      )
      expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
    })

    it('should reject comment when lines are in diff but not in same hunk', () => {
      // This tests the specific case that was causing the original error
      const comment: Comment = {
        path: 'test.ts',
        line: 27,
        start_line: 14,
        body: 'Lines in diff but different hunks'
      }

      // All lines are in the diff, but they span different hunks
      const diffMap = createDiffMapWithHunks([14, 15, 25, 26, 27], sampleHunks)
      expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
    })
  })
})
