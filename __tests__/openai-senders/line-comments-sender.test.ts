import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock the OpenAI SDK
const createMock = vi.fn()

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: createMock
      }
    }
  }
  return { default: MockOpenAI }
})

describe('openaiLineCommentsSender', () => {
  let openaiLineCommentsSender: (
    prompt: string,
    enableThinking?: boolean
  ) => Promise<string>

  beforeEach(async () => {
    vi.resetModules()
    createMock.mockReset()
    // Ensure env is set for tests
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.OPENAI_MODEL

    // Import after mocks & env set
    const mod = await import('../../src/openai-senders/line-comments-sender.ts')
    openaiLineCommentsSender = mod.openaiLineCommentsSender
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL
  })

  it('returns tool call arguments JSON when function tool call is present', async () => {
    const expected = { summary: 'Looks good', comments: [] }
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'provide_code_review',
                  arguments: JSON.stringify(expected)
                }
              }
            ]
          }
        }
      ]
    })

    const result = await openaiLineCommentsSender('test prompt')
    expect(result).toEqual(JSON.stringify(expected) || expect.any(String))
    // Ensure SDK called with default model
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5',
        tools: expect.any(Array)
      })
    )
  })

  it('uses OPENAI_MODEL when provided', async () => {
    process.env.OPENAI_MODEL = 'gpt-5'
    const expected = { summary: 'ok', comments: [] }
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'provide_code_review',
                  arguments: JSON.stringify(expected)
                }
              }
            ]
          }
        }
      ]
    })

    const result = await openaiLineCommentsSender('prompt')
    expect(JSON.parse(result)).toEqual(expected)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5'
      })
    )
  })

  it('falls back to parsing JSON in message content when no tool calls present', async () => {
    const jsonInBlock = { summary: 'fallback path', comments: [] }
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Please see:\n```json\n' + JSON.stringify(jsonInBlock) + '\n```'
          }
        }
      ]
    })

    const result = await openaiLineCommentsSender('test prompt')
    expect(JSON.parse(result)).toEqual(jsonInBlock)
  })

  it('throws when no choices returned', async () => {
    createMock.mockResolvedValue({ choices: [] })

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      'OpenAI API returned no choices'
    )
  })

  it('throws when tool call has invalid JSON', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'provide_code_review',
                  arguments: '{ invalid json'
                }
              }
            ]
          }
        }
      ]
    })

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      /OpenAI tool call returned invalid JSON/
    )
  })

  it('throws when no tool calls and no JSON content found', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'some plain text with no json'
          }
        }
      ]
    })

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      /Unexpected response format from OpenAI inline comment/
    )
  })
})
