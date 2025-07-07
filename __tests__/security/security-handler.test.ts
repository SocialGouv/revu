import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleSecurityReview } from '../../src/security/security-handler.ts'
import type { SecurityPromptContext } from '../../src/prompts/security-prompt.ts'

// Mock the dependencies
vi.mock('../../src/prompts/security-prompt.ts', () => ({
  generateSecurityPrompt: vi.fn()
}))

vi.mock('../../src/security/security-analysis-parser.ts', () => ({
  parseSecurityAnalysis: vi.fn()
}))

vi.mock('../../src/security/security-console-logger.ts', () => ({
  logSecurityReport: vi.fn()
}))

vi.mock('../../src/anthropic-senders/index.ts', () => ({
  getSender: vi.fn()
}))

describe('SecurityHandler', () => {
  describe('handleSecurityReview', () => {
    const mockContext: SecurityPromptContext = {
      repositoryUrl: 'https://github.com/test/repo.git',
      branch: 'feature/test',
      prNumber: 123,
      prTitle: 'Add authentication',
      prBody: 'This PR adds JWT authentication',
      gitDiff:
        "@@ -1,3 +1,5 @@\n+const jwt = require('jsonwebtoken')\n+const SECRET = 'hardcoded'",
      modifiedFiles: {
        'src/auth.ts':
          "const jwt = require('jsonwebtoken')\nconst SECRET = 'hardcoded'"
      }
    }

    const mockClaudeResponse = `{
      "summary": "Found 1 critical vulnerability: hardcoded secret",
      "findings": [
        {
          "severity": "Critical",
          "category": "Cryptography",
          "file": "src/auth.ts",
          "line": 2,
          "description": "Hardcoded JWT secret key",
          "recommendation": "Use environment variables"
        }
      ]
    }`

    const mockParsedAnalysis = {
      summary: 'Found 1 critical vulnerability: hardcoded secret',
      findings: [
        {
          severity: 'Critical' as const,
          category: 'Cryptography',
          file: 'src/auth.ts',
          line: 2,
          description: 'Hardcoded JWT secret key',
          recommendation: 'Use environment variables'
        }
      ]
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should orchestrate the complete security review process', async () => {
      const { generateSecurityPrompt } = await import(
        '../../src/prompts/security-prompt.ts'
      )
      const { parseSecurityAnalysis } = await import(
        '../../src/security/security-analysis-parser.ts'
      )
      const { logSecurityReport } = await import(
        '../../src/security/security-console-logger.ts'
      )
      const { getSender } = await import('../../src/anthropic-senders/index.ts')

      const mockPrompt = 'You are a security expert...'
      const mockSender = vi.fn().mockResolvedValue(mockClaudeResponse)

      vi.mocked(generateSecurityPrompt).mockReturnValue(mockPrompt)
      vi.mocked(getSender).mockReturnValue(mockSender)
      vi.mocked(parseSecurityAnalysis).mockReturnValue(mockParsedAnalysis)
      vi.mocked(logSecurityReport).mockImplementation(() => {})

      const result = await handleSecurityReview(mockContext)

      // Verify the orchestration flow
      expect(generateSecurityPrompt).toHaveBeenCalledWith(mockContext)
      expect(getSender).toHaveBeenCalledWith('security-review')
      expect(mockSender).toHaveBeenCalledWith(mockPrompt)
      expect(parseSecurityAnalysis).toHaveBeenCalledWith(mockClaudeResponse)
      expect(logSecurityReport).toHaveBeenCalledWith(
        'test/repo',
        123,
        mockParsedAnalysis
      )

      expect(result).toEqual(mockParsedAnalysis)
    })

    it('should handle Anthropic API errors gracefully', async () => {
      const { generateSecurityPrompt } = await import(
        '../../src/prompts/security-prompt.ts'
      )
      const { getSender } = await import('../../src/anthropic-senders/index.ts')
      const { logSecurityReport } = await import(
        '../../src/security/security-console-logger.ts'
      )

      const mockSender = vi.fn().mockRejectedValue(new Error('API Error'))
      vi.mocked(generateSecurityPrompt).mockReturnValue('test prompt')
      vi.mocked(getSender).mockReturnValue(mockSender)
      vi.mocked(logSecurityReport).mockImplementation(() => {})

      await expect(handleSecurityReview(mockContext)).rejects.toThrow(
        'Security review failed: API Error'
      )

      expect(logSecurityReport).toHaveBeenCalledWith(
        'test/repo',
        123,
        expect.objectContaining({
          summary: 'Security review failed due to API error',
          findings: []
        })
      )
    })

    it('should handle Claude response parsing errors', async () => {
      const { generateSecurityPrompt } = await import(
        '../../src/prompts/security-prompt.ts'
      )
      const { parseSecurityAnalysis } = await import(
        '../../src/security/security-analysis-parser.ts'
      )
      const { getSender } = await import('../../src/anthropic-senders/index.ts')
      const { logSecurityReport } = await import(
        '../../src/security/security-console-logger.ts'
      )

      const mockSender = vi.fn().mockResolvedValue('invalid json response')
      vi.mocked(generateSecurityPrompt).mockReturnValue('test prompt')
      vi.mocked(getSender).mockReturnValue(mockSender)
      vi.mocked(parseSecurityAnalysis).mockImplementation(() => {
        throw new Error('Invalid JSON response')
      })
      vi.mocked(logSecurityReport).mockImplementation(() => {})

      await expect(handleSecurityReview(mockContext)).rejects.toThrow(
        'Security review failed: Invalid JSON response'
      )

      expect(logSecurityReport).toHaveBeenCalledWith(
        'test/repo',
        123,
        expect.objectContaining({
          summary: 'Security review failed due to response parsing error',
          findings: []
        })
      )
    })

    it('should extract repository name correctly', async () => {
      const { generateSecurityPrompt } = await import(
        '../../src/prompts/security-prompt.ts'
      )
      const { getSender } = await import('../../src/anthropic-senders/index.ts')
      const { parseSecurityAnalysis } = await import(
        '../../src/security/security-analysis-parser.ts'
      )
      const { logSecurityReport } = await import(
        '../../src/security/security-console-logger.ts'
      )

      const mockSender = vi.fn().mockResolvedValue(mockClaudeResponse)
      vi.mocked(generateSecurityPrompt).mockReturnValue('test prompt')
      vi.mocked(getSender).mockReturnValue(mockSender)
      vi.mocked(parseSecurityAnalysis).mockReturnValue(mockParsedAnalysis)
      vi.mocked(logSecurityReport).mockImplementation(() => {})

      await handleSecurityReview(mockContext)

      expect(logSecurityReport).toHaveBeenCalledWith(
        'test/repo',
        123,
        mockParsedAnalysis
      )
    })

    it('should handle no vulnerabilities found', async () => {
      const { generateSecurityPrompt } = await import(
        '../../src/prompts/security-prompt.ts'
      )
      const { getSender } = await import('../../src/anthropic-senders/index.ts')
      const { parseSecurityAnalysis } = await import(
        '../../src/security/security-analysis-parser.ts'
      )
      const { logSecurityReport } = await import(
        '../../src/security/security-console-logger.ts'
      )

      const cleanResponse = `{
        "summary": "No security vulnerabilities found",
        "findings": []
      }`

      const cleanAnalysis = {
        summary: 'No security vulnerabilities found',
        findings: []
      }

      const mockSender = vi.fn().mockResolvedValue(cleanResponse)
      vi.mocked(generateSecurityPrompt).mockReturnValue('test prompt')
      vi.mocked(getSender).mockReturnValue(mockSender)
      vi.mocked(parseSecurityAnalysis).mockReturnValue(cleanAnalysis)
      vi.mocked(logSecurityReport).mockImplementation(() => {})

      const result = await handleSecurityReview(mockContext)

      expect(result).toEqual(cleanAnalysis)
      expect(logSecurityReport).toHaveBeenCalledWith(
        'test/repo',
        123,
        cleanAnalysis
      )
    })
  })
})
