import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Context } from 'probot'
import {
  createLineContentHash,
  extractHashFromComment,
  getLineContent,
  shouldReplaceComment
} from '../../src/comment-handlers/line-content-hash.ts'

// Mock GitHub API
const mockOctokit = {
  repos: {
    getContent: vi.fn()
  }
}

const mockContext = {
  octokit: mockOctokit,
  repo: () => ({ owner: 'test-owner', repo: 'test-repo' })
}

describe('Line Content Hash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createLineContentHash', () => {
    it('should create consistent hash for same content', () => {
      const content = 'const x = 5;\nconsole.log(x);'
      const hash1 = createLineContentHash(content)
      const hash2 = createLineContentHash(content)

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{8}$/) // 8-character hex hash
    })

    it('should create different hashes for different content', () => {
      const content1 = 'const x = 5;'
      const content2 = 'const y = 10;'

      const hash1 = createLineContentHash(content1)
      const hash2 = createLineContentHash(content2)

      expect(hash1).not.toBe(hash2)
    })

    it('should normalize whitespace consistently', () => {
      const content1 = '  const x = 5;  \n  console.log(x);  '
      const content2 = 'const x = 5;\nconsole.log(x);'

      const hash1 = createLineContentHash(content1)
      const hash2 = createLineContentHash(content2)

      expect(hash1).toBe(hash2)
    })

    it('should handle empty content', () => {
      const hash = createLineContentHash('')
      expect(hash).toMatch(/^[a-f0-9]{8}$/)
    })
  })

  describe('getLineContent', () => {
    const mockFileContent = `line 1
line 2
line 3
line 4
line 5`

    beforeEach(() => {
      mockOctokit.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from(mockFileContent).toString('base64'),
          encoding: 'base64'
        }
      })
    })

    it('should extract single line content', async () => {
      const content = await getLineContent(
        mockContext as unknown as Context,
        'test.ts',
        'abc123',
        3
      )

      expect(content).toBe('line 3')
      expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        path: 'test.ts',
        ref: 'abc123'
      })
    })

    it('should extract multi-line content', async () => {
      const content = await getLineContent(
        mockContext as unknown as Context,
        'test.ts',
        'abc123',
        4,
        2
      )

      expect(content).toBe('line 2\nline 3\nline 4')
    })

    it('should handle line numbers out of bounds', async () => {
      const content = await getLineContent(
        mockContext as unknown as Context,
        'test.ts',
        'abc123',
        10
      )

      expect(content).toBe('')
    })

    it('should handle API errors gracefully', async () => {
      mockOctokit.repos.getContent.mockRejectedValue(new Error('API Error'))

      const content = await getLineContent(
        mockContext as unknown as Context,
        'test.ts',
        'abc123',
        3
      )

      expect(content).toBe('')
    })
  })

  describe('extractHashFromComment', () => {
    it('should extract hash from comment with hash', () => {
      const comment =
        '<!-- REVU-AI-COMMENT file.ts:10 HASH:abc12345 -->\n\nComment body'
      const hash = extractHashFromComment(comment)

      expect(hash).toBe('abc12345')
    })

    it('should return null for comment without hash', () => {
      const comment = '<!-- REVU-AI-COMMENT file.ts:10 -->\n\nComment body'
      const hash = extractHashFromComment(comment)

      expect(hash).toBeNull()
    })

    it('should return null for malformed comment', () => {
      const comment = 'Regular comment without marker'
      const hash = extractHashFromComment(comment)

      expect(hash).toBeNull()
    })
  })

  describe('shouldReplaceComment', () => {
    it('should replace when no existing comment', () => {
      const currentHash = 'abc12345'
      const result = shouldReplaceComment(null, currentHash)

      expect(result).toBe(true)
    })

    it('should replace when existing comment has no hash', () => {
      const existingComment = {
        body: '<!-- REVU-AI-COMMENT file.ts:10 -->\n\nOld comment'
      }
      const currentHash = 'abc12345'

      const result = shouldReplaceComment(existingComment, currentHash)

      expect(result).toBe(true)
    })

    it('should not replace when hash matches', () => {
      const currentHash = 'abc12345'
      const existingComment = {
        body: `<!-- REVU-AI-COMMENT test.ts:1 HASH:${currentHash} -->\n\nOld comment`
      }

      const result = shouldReplaceComment(existingComment, currentHash)

      expect(result).toBe(false)
    })

    it('should replace when hash differs', () => {
      const currentHash = 'newhash1'
      const existingComment = {
        body: '<!-- REVU-AI-COMMENT file.ts:10 HASH:oldhash1 -->\n\nOld comment'
      }

      const result = shouldReplaceComment(existingComment, currentHash)

      expect(result).toBe(true)
    })

    it('should handle multi-line comments with matching hash', () => {
      const currentHash = 'abc12345'
      const existingComment = {
        body: `<!-- REVU-AI-COMMENT file.ts:2-3 HASH:${currentHash} -->\n\nOld comment`
      }

      const result = shouldReplaceComment(existingComment, currentHash)

      expect(result).toBe(false)
    })
  })
})
