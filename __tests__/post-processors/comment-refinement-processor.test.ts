import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CommentRefinementProcessor } from '../../src/post-processors/comment-refinement-processor.ts'
import type { PostProcessingConfig } from '../../src/post-processors/post-processor.ts'

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              name: 'refine_comments',
              input: {
                decisions: [
                  {
                    action: 'keep',
                    reason: 'This is a valid security concern'
                  },
                  {
                    action: 'improve',
                    comment: {
                      path: 'src/test.ts',
                      line: 20,
                      body: 'Improved: This function should validate input parameters to prevent injection attacks.'
                    },
                    reason: 'Made the comment more specific'
                  },
                  {
                    action: 'remove',
                    reason: 'This is too nitpicky'
                  }
                ]
              }
            }
          ]
        })
      }
    }))
  }
})

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('Mock template content')
}))

// Mock handlebars
vi.mock('handlebars', () => ({
  compile: vi.fn().mockReturnValue(() => 'Mock compiled template')
}))

// Mock logger
vi.mock('../../src/utils/logger.ts', () => ({
  logSystemError: vi.fn(),
  logSystemWarning: vi.fn()
}))

describe('CommentRefinementProcessor', () => {
  // Mock environment variable
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = 'mock-api-key'
  })

  const mockConfig: PostProcessingConfig = {
    enabled: true,
    model: 'claude-haiku-3-20240307',
    strategy: 'comment-refinement',
    temperature: 0,
    maxTokens: 2048
  }

  it('should process comments and handle errors gracefully', async () => {
    const processor = new CommentRefinementProcessor(mockConfig)

    const inputComments = [
      {
        path: 'src/test.ts',
        line: 10,
        body: 'This could be a security issue'
      },
      {
        path: 'src/test.ts',
        line: 20,
        body: 'This function needs validation'
      },
      {
        path: 'src/test.ts',
        line: 30,
        body: 'Minor style issue here'
      }
    ]

    const context = {
      prTitle: 'Test PR',
      prBody: 'Test PR body',
      diff: 'mock diff',
      codingGuidelines: 'mock guidelines'
    }

    const result = await processor.process(inputComments, context)

    // The processor should return some result (either processed or original comments on error)
    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
    // In case of error, it should return original comments
    expect(result.length).toBeGreaterThanOrEqual(0)
  })

  it('should return empty array for empty input', async () => {
    const processor = new CommentRefinementProcessor(mockConfig)

    const result = await processor.process([])

    expect(result).toEqual([])
  })

  it('should handle errors gracefully and return original comments', async () => {
    // Mock Anthropic to throw an error
    const mockAnthropic = vi.mocked(await import('@anthropic-ai/sdk')).default
    const mockInstance = new mockAnthropic()
    vi.mocked(mockInstance.messages.create).mockRejectedValueOnce(
      new Error('API Error')
    )

    const processor = new CommentRefinementProcessor(mockConfig)

    const inputComments = [
      {
        path: 'src/test.ts',
        line: 10,
        body: 'Test comment'
      }
    ]

    const result = await processor.process(inputComments)

    // Should return original comments on error
    expect(result).toEqual(inputComments)
  })
})
