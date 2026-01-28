import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCommentMarkerId,
  extractMarkerIdFromComment,
  isCommentValidForDiff,
  prepareCommentContent
} from '../../src/comment-handlers/comment-utils.ts'
import type { Comment } from '../../src/comment-handlers/types.ts'

// Only mock the complex search-replace processor
vi.mock('../../src/core/services/search-replace-processor.ts', async () => {
  const actual = await vi.importActual(
    '../../src/core/services/search-replace-processor.ts'
  )
  return {
    ...actual,
    processSearchReplaceBlocks: vi.fn()
  }
})

// Import the mocked function for testing
import { processSearchReplaceBlocks } from '../../src/core/services/search-replace-processor.ts'

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

describe('isCommentValidForDiff', () => {
  const createDiffMap = (files: Record<string, number[]>) => {
    const diffMap = new Map()
    for (const [path, lines] of Object.entries(files)) {
      // Create a simple hunk that covers all changed lines
      const minLine = Math.min(...lines)
      const maxLine = Math.max(...lines)
      const hunks =
        lines.length > 0
          ? [
              {
                startLine: minLine,
                endLine: maxLine,
                header: `@@ -${minLine},${maxLine - minLine + 1} +${minLine},${maxLine - minLine + 1} @@`
              }
            ]
          : []

      diffMap.set(path, {
        changedLines: new Set(lines),
        hunks
      })
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

describe('prepareCommentContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should dedupe identical ```suggestion blocks inside a single comment body', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'const x = 1;',
          replace: 'const x = 2;'
        }
      ]
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    // Model already duplicated suggestion blocks in its body.
    comment.body =
      'This is a comment\n\n```suggestion\nconst x = 2;\n```\n\nSome text\n\n```suggestion\nconst x = 2;\n```'

    // SEARCH/REPLACE would also generate the same suggestion.
    vi.mocked(processSearchReplaceBlocks).mockResolvedValue({
      success: true,
      errors: [],
      appliedBlocks: 1,
      replacementContent: 'const x = 2;'
    })

    const result = await prepareCommentContent(comment, fileContent)

    const suggestionCount = (result.content.match(/```suggestion/g) || [])
      .length
    expect(suggestionCount).toBe(1)
    expect(result.content).toContain('```suggestion\nconst x = 2;\n```')
  })

  it('should keep multiple distinct ```suggestion blocks', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'Text\n\n```suggestion\nconst a = 1;\n```\n\nMore\n\n```suggestion\nconst b = 2;\n```'
    }
    const fileContent = 'const a = 0;\nconst b = 0;'

    const result = await prepareCommentContent(comment, fileContent)

    const suggestionCount = (result.content.match(/```suggestion/g) || [])
      .length
    expect(suggestionCount).toBe(2)
    expect(result.content).toContain('```suggestion\nconst a = 1;\n```')
    expect(result.content).toContain('```suggestion\nconst b = 2;\n```')
  })

  it('should prepare basic comment content without search/replace blocks', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment'
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.content).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis is a comment'
    )
    expect(result.updatedComment).toEqual(comment)
    expect(processSearchReplaceBlocks).not.toHaveBeenCalled()
  })

  it('should prepare comment content with hash', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment'
    }
    const fileContent = 'const x = 1;\nconst y = 2;'
    const hash = 'abc12345'

    const result = await prepareCommentContent(comment, fileContent, hash)

    expect(result.content).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 HASH:abc12345 -->\n\nThis is a comment'
    )
    expect(result.updatedComment).toEqual(comment)
  })

  it('should prepare multi-line comment content', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 15,
      start_line: 10,
      body: 'Multi-line comment'
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.content).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10-15 -->\n\nMulti-line comment'
    )
    expect(result.updatedComment).toEqual(comment)
  })

  it('should process search/replace blocks successfully and preserve original positioning when line data is zero', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'const x = 1;',
          replace: 'const x = 2;'
        }
      ]
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    // When originalStartLine and originalEndLine are 0, it typically means
    // the search/replace processor couldn't determine precise line positioning
    // In this case, the original comment positioning should be preserved
    vi.mocked(processSearchReplaceBlocks).mockResolvedValue({
      success: true,
      errors: [],
      appliedBlocks: 1,
      replacementContent: 'const x = 2;',
      originalStartLine: 0,
      originalEndLine: 0
    })

    const result = await prepareCommentContent(comment, fileContent)

    expect(processSearchReplaceBlocks).toHaveBeenCalledWith(
      fileContent,
      comment.search_replace_blocks
    )
    expect(result.content).toContain('```suggestion\nconst x = 2;\n```')
    expect(result.updatedComment.start_line).toBe(1) // 0 + 1 (converted to 1-based)
    expect(result.updatedComment.line).toBe(1) // 0 + 1 (converted to 1-based)

    // Verify the marker ID is updated to reflect the new positioning
    expect(result.content).toContain('<!-- REVU-AI-COMMENT src_file.ts:1-1 -->')
  })

  it('should update marker ID when line positioning changes', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'const x = 1;',
          replace: 'const x = 2;'
        }
      ]
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    vi.mocked(processSearchReplaceBlocks).mockResolvedValue({
      success: true,
      errors: [],
      appliedBlocks: 1,
      replacementContent: 'const x = 2;',
      originalStartLine: 5,
      originalEndLine: 8
    })

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.updatedComment.start_line).toBe(6) // 5 + 1 (converted to 1-based)
    expect(result.updatedComment.line).toBe(9) // 8 + 1 (converted to 1-based)
    expect(result.content).toContain('<!-- REVU-AI-COMMENT src_file.ts:6-9 -->')
  })

  it('should handle search/replace processing failure', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'nonexistent code',
          replace: 'replacement'
        }
      ]
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    vi.mocked(processSearchReplaceBlocks).mockResolvedValue({
      success: false,
      errors: ['Search pattern not found'],
      appliedBlocks: 0
    })

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.content).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis is a comment'
    )
    expect(result.updatedComment).toEqual(comment)
  })

  it('should handle search/replace processing exception', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'const x = 1;',
          replace: 'const x = 2;'
        }
      ]
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    vi.mocked(processSearchReplaceBlocks).mockRejectedValue(
      new Error('Processing failed')
    )

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.content).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis is a comment'
    )
    expect(result.updatedComment).toEqual(comment)
  })

  it('should handle empty search/replace blocks array', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: []
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.content).toBe(
      '<!-- REVU-AI-COMMENT src_file.ts:10 -->\n\nThis is a comment'
    )
    expect(result.updatedComment).toEqual(comment)
    expect(processSearchReplaceBlocks).not.toHaveBeenCalled()
  })

  it('should preserve original comment positioning when line positioning data is not provided', async () => {
    const comment: Comment = {
      path: 'src/file.ts',
      line: 10,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'const x = 1;',
          replace: 'const x = 2;'
        }
      ]
    }
    const fileContent = 'const x = 1;\nconst y = 2;'

    // When originalStartLine/originalEndLine are undefined (not provided),
    // the original comment positioning should be preserved
    vi.mocked(processSearchReplaceBlocks).mockResolvedValue({
      success: true,
      errors: [],
      appliedBlocks: 1,
      replacementContent: 'const x = 2;\nconst y = 2;'
      // No originalStartLine/originalEndLine provided
    })

    const result = await prepareCommentContent(comment, fileContent)

    expect(processSearchReplaceBlocks).toHaveBeenCalledWith(
      fileContent,
      comment.search_replace_blocks
    )
    expect(result.content).toContain(
      '```suggestion\nconst x = 2;\nconst y = 2;\n```'
    )

    // Verify that the original comment positioning is preserved
    expect(result.updatedComment.line).toBe(comment.line) // Should remain 10
    expect(result.updatedComment.start_line).toBe(comment.start_line) // Should remain undefined
    expect(result.updatedComment.path).toBe(comment.path)
    expect(result.updatedComment.body).toBe(comment.body)

    // Verify the original marker ID is preserved (single line comment)
    expect(result.content).toContain('<!-- REVU-AI-COMMENT src_file.ts:10 -->')

    // Ensure the marker ID was NOT updated to reflect new positioning
    expect(result.content).not.toContain(
      '<!-- REVU-AI-COMMENT src_file.ts:1-1 -->'
    )
  })

  it('should handle complex file paths in marker ID updates', async () => {
    const comment: Comment = {
      path: 'src/components/@types/api.d.ts',
      line: 10,
      start_line: 5,
      body: 'This is a comment',
      search_replace_blocks: [
        {
          search: 'interface User',
          replace: 'interface UserData'
        }
      ]
    }
    const fileContent = 'interface User {\n  id: number;\n}'

    vi.mocked(processSearchReplaceBlocks).mockResolvedValue({
      success: true,
      errors: [],
      appliedBlocks: 1,
      replacementContent: 'interface UserData',
      originalStartLine: 2,
      originalEndLine: 4
    })

    const result = await prepareCommentContent(comment, fileContent)

    expect(result.content).toContain(
      '<!-- REVU-AI-COMMENT src_components__types_api.d.ts:3-5 -->'
    )
    expect(result.updatedComment.start_line).toBe(3) // 2 + 1
    expect(result.updatedComment.line).toBe(5) // 4 + 1
  })
})
