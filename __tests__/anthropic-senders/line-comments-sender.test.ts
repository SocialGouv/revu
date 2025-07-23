import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lineCommentsSender } from '../../src/anthropic-senders/line-comments-sender.ts'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      }
    }))
  }
})

describe('lineCommentsSender', () => {
  let mockAnthropic: {
    messages: {
      create: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    // Get the mocked Anthropic constructor
    const AnthropicConstructor = (await import('@anthropic-ai/sdk'))
      .default as unknown as ReturnType<typeof vi.fn>
    mockAnthropic = {
      messages: {
        create: vi.fn()
      }
    }
    AnthropicConstructor.mockReturnValue(mockAnthropic)

    // Set up environment variable
    process.env.ANTHROPIC_API_KEY = 'test-api-key'
  })

  it('should handle successful tool use response', async () => {
    const expectedResponse = {
      summary: 'Test summary',
      comments: [
        {
          path: 'test.ts',
          line: 10,
          body: 'Test comment'
        }
      ]
    }

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'provide_code_review',
          input: expectedResponse
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedResponse))
  })

  it('should handle fallback with JSON in code block', async () => {
    const expectedJson = {
      summary: 'Fallback summary',
      comments: [
        {
          path: 'fallback.ts',
          line: 20,
          body: 'Fallback comment'
        }
      ]
    }

    const textResponse = `Here's the analysis:

\`\`\`json
${JSON.stringify(expectedJson, null, 2)}
\`\`\`

This is the code review result.`

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: textResponse
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedJson, null, 2))
  })

  it('should handle fallback with plain JSON response', async () => {
    const expectedJson = {
      summary: 'Plain JSON summary',
      comments: [
        {
          path: 'plain.ts',
          line: 30,
          body: 'Plain JSON comment'
        }
      ]
    }

    const jsonResponse = JSON.stringify(expectedJson)

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: jsonResponse
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')
    expect(result).toBe(jsonResponse)
  })

  it('should handle fallback with mixed content (JSON takes priority)', async () => {
    const expectedJson = {
      summary: 'Priority test',
      comments: [
        {
          path: 'priority.ts',
          line: 40,
          body: 'Priority comment'
        }
      ]
    }

    const textWithJson = `Some text before

\`\`\`json
${JSON.stringify(expectedJson)}
\`\`\`

Some text after that should be ignored`

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: textWithJson
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedJson))
  })

  it('should fall back to plain text only when no JSON is found', async () => {
    const plainTextResponse = 'This is just plain text without any JSON'

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: plainTextResponse
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')
    expect(result).toBe(plainTextResponse)
  })

  it('should throw error for unexpected tool name', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'unexpected_tool',
          input: { some: 'data' }
        }
      ]
    })

    await expect(lineCommentsSender('test prompt')).rejects.toThrow(
      'Unexpected tool name: unexpected_tool'
    )
  })

  it('should throw error when no content is found', async () => {
    mockAnthropic.messages.create.mockResolvedValue({
      content: []
    })

    await expect(lineCommentsSender('test prompt')).rejects.toThrow(
      'Unexpected response format from Anthropic inline comment - no content found'
    )
  })

  it('should handle invalid JSON in code block (falls back to plain text)', async () => {
    const invalidJsonInCodeBlock = `Here's the analysis:

\`\`\`json
{
  "summary": "Test summary",
  "comments": [
    {
      "path": "test.ts",
      "line": 10,
      "body": "Comment"
    // Missing closing bracket - invalid JSON
  ]
}
\`\`\`

This should fallback to the entire text since JSON is invalid.`

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: invalidJsonInCodeBlock
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')

    // Should return the invalid JSON string (not the whole text)
    // The validation happens later in lineCommentsHandler
    expect(result).toContain('"summary": "Test summary"')
    expect(result).toContain('// Missing closing bracket')
  })

  it('should handle invalid JSON as plain text', async () => {
    const invalidJsonText = `{"summary":"Test","comments":[{"path":"test.ts","line":10}` // Missing closing brackets

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: invalidJsonText
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')

    // Should return the invalid JSON string as-is
    // The validation/parsing happens in lineCommentsHandler
    expect(result).toBe(invalidJsonText)
  })

  it('should handle malformed text that looks like JSON but is not', async () => {
    const malformedJson = `{this is not valid json at all}`

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: malformedJson
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')

    // Should return the malformed JSON as-is
    expect(result).toBe(malformedJson)
  })

  it('should prefer JSON in code block over malformed JSON-like text', async () => {
    const validJson = {
      summary: 'Valid summary',
      comments: [
        {
          path: 'valid.ts',
          line: 15,
          body: 'Valid comment'
        }
      ]
    }

    const textWithValidJsonInCodeBlock = `Some analysis text with malformed JSON-like content {invalid: json}.

But here's the valid JSON:

\`\`\`json
${JSON.stringify(validJson, null, 2)}
\`\`\`

More text after.`

    mockAnthropic.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: textWithValidJsonInCodeBlock
        }
      ]
    })

    const result = await lineCommentsSender('test prompt')

    // Should return the valid JSON from the code block, not the malformed JSON-like text
    expect(result).toBe(JSON.stringify(validJson, null, 2))
  })
})
