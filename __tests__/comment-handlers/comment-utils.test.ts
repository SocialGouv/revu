import { describe, expect, it } from 'vitest'
import {
  createCommentMarkerId,
  extractMarkerIdFromComment,
  isCommentValidForDiff,
  prepareCommentContent
} from '../../src/comment-handlers/comment-utils.ts'
import type { Comment } from '../../src/comment-handlers/types.ts'

describe('createCommentMarkerId', () => {
  it('should create markerId for single-line comment', () => {
    const markerId = createCommentMarkerId('src/file.ts', 10)
    expect(markerId).toBe('src_file.ts:10')
  })

  it('should create markerId for multi-line comment', () => {
    const markerId = createCommentMarkerId('src/file.ts', 15, 10)
    expect(markerId).toBe('src_file.ts:10-15')
  })

  it('should create markerId for edge case where start_line equals line', () => {
    const markerId = createCommentMarkerId('src/file.ts', 10, 10)
    expect(markerId).toBe('src_file.ts:10-10')
  })

  it('should sanitize special characters in file path', () => {
    const markerId = createCommentMarkerId(
      'src/components/my-component.tsx',
      10
    )
    expect(markerId).toBe('src_components_my-component.tsx:10')
  })

  it('should handle complex file paths with various special characters', () => {
    const markerId = createCommentMarkerId('src/utils/@types/api.d.ts', 25, 20)
    expect(markerId).toBe('src_utils__types_api.d.ts:20-25')
  })

  it('should handle file paths with spaces', () => {
    const markerId = createCommentMarkerId('my folder/file name.ts', 5)
    expect(markerId).toBe('my_folder_file_name.ts:5')
  })
})

describe('extractMarkerIdFromComment', () => {
  it('should extract markerId from comment with marker', () => {
    const commentBody =
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis is a comment'
    const markerId = extractMarkerIdFromComment(commentBody)
    expect(markerId).toBe('src_file.ts:10')
  })

  it('should extract markerId from multi-line comment', () => {
    const commentBody =
      '<!-- REVU-AI-COMMENT src_file.ts:10-15 -->\n\nMulti-line comment'
    const markerId = extractMarkerIdFromComment(commentBody)
    expect(markerId).toBe('src_file.ts:10-15')
  })

  it('should extract markerId with sanitized characters', () => {
    const commentBody =
      '<!-- REVU-AI-COMMENT src_components_my-component.tsx:10 -->\n\nComment'
    const markerId = extractMarkerIdFromComment(commentBody)
    expect(markerId).toBe('src_components_my-component.tsx:10')
  })

  it('should return null for comment without marker', () => {
    const commentBody = 'This is a regular comment without marker'
    const markerId = extractMarkerIdFromComment(commentBody)
    expect(markerId).toBeNull()
  })

  it('should return null for comment with malformed marker', () => {
    const commentBody = '<!-- REVU-AI-COMMENT -->\n\nMalformed marker'
    const markerId = extractMarkerIdFromComment(commentBody)
    expect(markerId).toBeNull()
  })

  it('should handle marker at different positions in comment', () => {
    const commentBody =
      'Some text\n<!-- REVU-AI-COMMENT file.ts:5 -->\nMore text'
    const markerId = extractMarkerIdFromComment(commentBody)
    expect(markerId).toBe('file.ts:5')
  })
})

describe('prepareCommentContent', () => {
  it('should prepare single-line comment without suggestion', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This needs attention'
    }

    const commentBody = prepareCommentContent(comment)

    expect(commentBody).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis needs attention'
    )
  })

  it('should prepare multi-line comment without suggestion', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      body: 'Multi-line issue'
    }

    const commentBody = prepareCommentContent(comment)

    expect(commentBody).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10-15 -->\n\nMulti-line issue'
    )
  })

  it('should prepare comment with suggestion', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This can be improved',
      suggestion: 'const improved = true'
    }

    const commentBody = prepareCommentContent(comment)

    expect(commentBody).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis can be improved\n\n```suggestion\nconst improved = true\n```'
    )
  })

  it('should handle null suggestion', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'Comment without suggestion',
      suggestion: null
    }

    const commentBody = prepareCommentContent(comment)

    expect(commentBody).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nComment without suggestion'
    )
  })

  it('should handle multi-line suggestion', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      body: 'Refactor this block',
      suggestion: 'const result = calculate()\nreturn result'
    }

    const commentBody = prepareCommentContent(comment)

    expect(commentBody).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10-15 -->\n\nRefactor this block\n\n```suggestion\nconst result = calculate()\nreturn result\n```'
    )
  })

  it('should sanitize file path in markerId', () => {
    const comment: Comment = {
      path: 'src/components/my-component.tsx',
      line: 10,
      body: 'Component issue'
    }

    const commentBody = prepareCommentContent(comment)

    expect(commentBody).toContain(
      '<!-- REVU-AI-COMMENT src_components_my-component.tsx:10 -->'
    )
  })
})

describe('isCommentValidForDiff', () => {
  const createDiffMap = (files: Record<string, number[]>) => {
    const diffMap = new Map()
    for (const [path, lines] of Object.entries(files)) {
      diffMap.set(path, { changedLines: new Set(lines) })
    }
    return diffMap
  }

  it('should validate single-line comment when line is in diff', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'Comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [10, 11, 12]
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(true)
  })

  it('should reject single-line comment when line is not in diff', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      body: 'Comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [10, 11, 12]
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
  })

  it('should reject comment when file is not in diff', () => {
    const comment: Comment = {
      path: 'src/other.ts',
      line: 10,
      body: 'Comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [10, 11, 12]
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
  })

  it('should validate multi-line comment when all lines are in diff', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      body: 'Multi-line comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(true)
  })

  it('should reject multi-line comment when some lines are missing from diff', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      body: 'Multi-line comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [10, 11, 12] // Missing lines 13, 14, 15
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
  })

  it('should validate multi-line comment when start_line equals line', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      start_line: 10,
      body: 'Single line range'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [10, 11, 12]
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(true)
  })

  it('should handle empty diff map', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'Comment'
    }

    const diffMap = createDiffMap({})

    expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
  })

  it('should handle file with empty changed lines', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'Comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': []
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
  })

  it('should validate complex multi-line range', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 25,
      start_line: 20,
      body: 'Large block comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(true)
  })

  it('should reject when only partial range is covered', () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 25,
      start_line: 20,
      body: 'Large block comment'
    }

    const diffMap = createDiffMap({
      'src/file.ts': [20, 21, 22, 23] // Missing lines 24, 25
    })

    expect(isCommentValidForDiff(comment, diffMap)).toBe(false)
  })
})
