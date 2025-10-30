import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anthropicLineCommentsSender } from '../../src/senders/providers/anthropic/line-comments-sender.ts'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      },
      beta: {
        messages: {
          create: vi.fn()
        }
      }
    }))
  }
})

// Helper types
type Comment = {
  path: string
  line: number
  body: string
}

type ReviewResponse = {
  summary: string
  comments?: Comment[]
}

// Test helpers
const createComment = (path: string, line: number, body: string): Comment => ({
  path,
  line,
  body
})

const createReviewResponse = (
  summary: string,
  comments?: Comment[]
): ReviewResponse => {
  const response: ReviewResponse = { summary }
  if (comments) {
    response.comments = comments
  }
  return response
}

const createToolUseContent = (input: ReviewResponse) => ({
  type: 'tool_use' as const,
  name: 'provide_code_review',
  input
})

const createTextContent = (text: string) => ({
  type: 'text' as const,
  text
})

const createThinkingContent = (thinking: string) => ({
  type: 'thinking' as const,
  thinking,
  signature: 'mock-signature'
})

type MockAnthropicType = {
  messages: {
    create: ReturnType<typeof vi.fn>
  }
  beta: {
    messages: {
      create: ReturnType<typeof vi.fn>
    }
  }
}

const mockToolUseResponse = (
  mockAnthropic: MockAnthropicType,
  response: ReviewResponse,
  useBeta = true
) => {
  const target = useBeta
    ? mockAnthropic.beta.messages.create
    : mockAnthropic.messages.create
  target.mockResolvedValue({
    content: [createToolUseContent(response)]
  })
}

const mockTextResponse = (
  mockAnthropic: MockAnthropicType,
  text: string,
  useBeta = true
) => {
  const target = useBeta
    ? mockAnthropic.beta.messages.create
    : mockAnthropic.messages.create
  target.mockResolvedValue({
    content: [createTextContent(text)]
  })
}

const mockMixedResponse = (
  mockAnthropic: MockAnthropicType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any[],
  useBeta = true
) => {
  const target = useBeta
    ? mockAnthropic.beta.messages.create
    : mockAnthropic.messages.create
  target.mockResolvedValue({ content })
}

describe('anthropicLineCommentsSender', () => {
  let mockAnthropic: {
    messages: {
      create: ReturnType<typeof vi.fn>
    }
    beta: {
      messages: {
        create: ReturnType<typeof vi.fn>
      }
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
      },
      beta: {
        messages: {
          create: vi.fn()
        }
      }
    }
    AnthropicConstructor.mockReturnValue(mockAnthropic)

    // Set up environment variables
    process.env.ANTHROPIC_API_KEY = 'test-api-key'
    // Reset extended context to default (enabled)
    delete process.env.ANTHROPIC_EXTENDED_CONTEXT
  })

  it('should handle successful tool use response', async () => {
    const expectedResponse = createReviewResponse('Test summary', [
      createComment('test.ts', 10, 'Test comment')
    ])

    mockToolUseResponse(mockAnthropic, expectedResponse)

    const result = await anthropicLineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedResponse))
  })

  it('should handle tool use response with only summary (no comments)', async () => {
    const expectedResponse = createReviewResponse('No issues found in this PR')

    mockToolUseResponse(mockAnthropic, expectedResponse)

    const result = await anthropicLineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedResponse))
  })

  it('should handle fallback with JSON in code block', async () => {
    const expectedJson = createReviewResponse('Fallback summary', [
      createComment('fallback.ts', 20, 'Fallback comment')
    ])

    const textResponse = `Here's the analysis:

\`\`\`json
${JSON.stringify(expectedJson, null, 2)}
\`\`\`

This is the code review result.`

    mockTextResponse(mockAnthropic, textResponse)

    const result = await anthropicLineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedJson, null, 2))
  })

  it('should handle fallback with plain JSON response', async () => {
    const expectedJson = createReviewResponse('Plain JSON summary', [
      createComment('plain.ts', 30, 'Plain JSON comment')
    ])

    const jsonResponse = JSON.stringify(expectedJson)
    mockTextResponse(mockAnthropic, jsonResponse)

    const result = await anthropicLineCommentsSender('test prompt')
    expect(result).toBe(jsonResponse)
  })

  it('should handle fallback with mixed content (JSON takes priority)', async () => {
    const expectedJson = createReviewResponse('Priority test', [
      createComment('priority.ts', 40, 'Priority comment')
    ])

    const textWithJson = `Some text before

\`\`\`json
${JSON.stringify(expectedJson)}
\`\`\`

Some text after that should be ignored`

    mockTextResponse(mockAnthropic, textWithJson)

    const result = await anthropicLineCommentsSender('test prompt')
    expect(result).toBe(JSON.stringify(expectedJson))
  })

  it('should fall back to plain text only when no JSON is found', async () => {
    const plainTextResponse = 'This is just plain text without any JSON'

    mockTextResponse(mockAnthropic, plainTextResponse)

    const result = await anthropicLineCommentsSender('test prompt')
    expect(result).toBe(plainTextResponse)
  })

  it('should throw error for unexpected tool name', async () => {
    mockMixedResponse(mockAnthropic, [
      {
        type: 'tool_use',
        name: 'unexpected_tool',
        input: { some: 'data' }
      }
    ])

    await expect(anthropicLineCommentsSender('test prompt')).rejects.toThrow(
      'Unexpected tool name: unexpected_tool'
    )
  })

  it('should throw error when no content is found', async () => {
    mockMixedResponse(mockAnthropic, [])

    await expect(anthropicLineCommentsSender('test prompt')).rejects.toThrow(
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

    mockTextResponse(mockAnthropic, invalidJsonInCodeBlock)

    const result = await anthropicLineCommentsSender('test prompt')

    // Should return the invalid JSON string (not the whole text)
    // The validation happens later in lineCommentsHandler
    expect(result).toContain('"summary": "Test summary"')
    expect(result).toContain('// Missing closing bracket')
  })

  it('should handle invalid JSON as plain text', async () => {
    const invalidJsonText = `{"summary":"Test","comments":[{"path":"test.ts","line":10}` // Missing closing brackets

    mockTextResponse(mockAnthropic, invalidJsonText)

    const result = await anthropicLineCommentsSender('test prompt')

    // Should return the invalid JSON string as-is
    // The validation/parsing happens in lineCommentsHandler
    expect(result).toBe(invalidJsonText)
  })

  it('should handle malformed text that looks like JSON but is not', async () => {
    const malformedJson = `{this is not valid json at all}`

    mockTextResponse(mockAnthropic, malformedJson)

    const result = await anthropicLineCommentsSender('test prompt')

    // Should return the malformed JSON as-is
    expect(result).toBe(malformedJson)
  })

  it('should prefer JSON in code block over malformed JSON-like text', async () => {
    const validJson = createReviewResponse('Valid summary', [
      createComment('valid.ts', 15, 'Valid comment')
    ])

    const textWithValidJsonInCodeBlock = `Some analysis text with malformed JSON-like content {invalid: json}.

But here's the valid JSON:

\`\`\`json
${JSON.stringify(validJson, null, 2)}
\`\`\`

More text after.`

    mockTextResponse(mockAnthropic, textWithValidJsonInCodeBlock)

    const result = await anthropicLineCommentsSender('test prompt')

    // Should return the valid JSON from the code block, not the malformed JSON-like text
    expect(result).toBe(JSON.stringify(validJson, null, 2))
  })

  describe('Extended Thinking Support', () => {
    it('should enable thinking for line-comments strategy', async () => {
      const expectedResponse = createReviewResponse(
        'Thinking-enabled summary',
        [createComment('thinking.ts', 5, 'Comment with thinking')]
      )

      mockMixedResponse(mockAnthropic, [
        createThinkingContent('Let me analyze this code step by step...'),
        createToolUseContent(expectedResponse)
      ])

      const result = await anthropicLineCommentsSender('test prompt', true)

      // Should extract only the tool_use result, ignoring thinking blocks
      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify thinking was enabled in the API call
      expect(mockAnthropic.beta.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: {
            type: 'enabled',
            budget_tokens: 16000
          },
          max_tokens: 20096
        })
      )
    })

    it('should not enable thinking for regular line-comments strategy', async () => {
      const expectedResponse = createReviewResponse('Regular summary', [
        createComment('regular.ts', 10, 'Regular comment')
      ])

      mockToolUseResponse(mockAnthropic, expectedResponse)

      const result = await anthropicLineCommentsSender('test prompt', false)

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify thinking was NOT enabled in the API call (uses beta API by default)
      expect(mockAnthropic.beta.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096
        })
      )

      // Verify thinking config was not included
      const callArgs = mockAnthropic.beta.messages.create.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('thinking')
    })

    it('should not enable thinking when no strategy is provided', async () => {
      const expectedResponse = createReviewResponse('Default summary')

      mockToolUseResponse(mockAnthropic, expectedResponse)

      const result = await anthropicLineCommentsSender('test prompt')

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify thinking was NOT enabled (uses beta API by default)
      const callArgs = mockAnthropic.beta.messages.create.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('thinking')
      expect(callArgs.max_tokens).toBe(4096)
    })
  })

  describe('Extended Context Window Support', () => {
    it('should use beta API with extended context by default', async () => {
      const expectedResponse = createReviewResponse(
        'Extended context summary',
        [createComment('extended.ts', 5, 'Comment with 1M context')]
      )

      mockToolUseResponse(mockAnthropic, expectedResponse)

      const result = await anthropicLineCommentsSender('test prompt')

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify beta API was used
      expect(mockAnthropic.beta.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          betas: ['context-1m-2025-08-07']
        })
      )

      // Verify standard API was NOT used
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled()
    })

    it('should use beta API when ANTHROPIC_EXTENDED_CONTEXT is explicitly set to "true"', async () => {
      process.env.ANTHROPIC_EXTENDED_CONTEXT = 'true'

      const expectedResponse = createReviewResponse('Extended context enabled')

      mockToolUseResponse(mockAnthropic, expectedResponse)

      const result = await anthropicLineCommentsSender('test prompt')

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify beta API was used with betas parameter
      expect(mockAnthropic.beta.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          betas: ['context-1m-2025-08-07']
        })
      )

      // Verify standard API was NOT used
      expect(mockAnthropic.messages.create).not.toHaveBeenCalled()
    })

    it('should use standard API when ANTHROPIC_EXTENDED_CONTEXT is set to "false"', async () => {
      process.env.ANTHROPIC_EXTENDED_CONTEXT = 'false'

      const expectedResponse = createReviewResponse(
        'Standard context summary',
        [createComment('standard.ts', 10, 'Comment with standard context')]
      )

      mockToolUseResponse(mockAnthropic, expectedResponse, false)

      const result = await anthropicLineCommentsSender('test prompt')

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify standard API was used
      expect(mockAnthropic.messages.create).toHaveBeenCalled()

      // Verify betas parameter was NOT included
      const callArgs = mockAnthropic.messages.create.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('betas')

      // Verify beta API was NOT used
      expect(mockAnthropic.beta.messages.create).not.toHaveBeenCalled()
    })

    it('should work with extended context and thinking enabled together', async () => {
      const expectedResponse = createReviewResponse(
        'Extended context with thinking',
        [createComment('both.ts', 15, 'Comment with both features')]
      )

      mockMixedResponse(mockAnthropic, [
        createThinkingContent('Analyzing with extended context...'),
        createToolUseContent(expectedResponse)
      ])

      const result = await anthropicLineCommentsSender('test prompt', true)

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify beta API was used with both extended context and thinking
      expect(mockAnthropic.beta.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          betas: ['context-1m-2025-08-07'],
          thinking: {
            type: 'enabled',
            budget_tokens: 16000
          },
          max_tokens: 20096
        })
      )
    })

    it('should work with standard context and thinking enabled together', async () => {
      process.env.ANTHROPIC_EXTENDED_CONTEXT = 'false'

      const expectedResponse = createReviewResponse(
        'Standard context with thinking'
      )

      mockMixedResponse(
        mockAnthropic,
        [
          createThinkingContent('Analyzing with standard context...'),
          createToolUseContent(expectedResponse)
        ],
        false
      )

      const result = await anthropicLineCommentsSender('test prompt', true)

      expect(result).toBe(JSON.stringify(expectedResponse))

      // Verify standard API was used with thinking but NOT extended context
      expect(mockAnthropic.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: {
            type: 'enabled',
            budget_tokens: 16000
          },
          max_tokens: 20096
        })
      )

      // Verify betas parameter was NOT included
      const callArgs = mockAnthropic.messages.create.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('betas')
    })
  })
})
