import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { openaiLineCommentsSender } from '../../src/senders/providers/openai/line-comments-sender.ts'
import { REVIEW_TOOL_NAME } from '../../src/senders/shared/review-tool-schema.ts'

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
  beforeEach(async () => {
    vi.resetModules()
    createMock.mockReset()
    // Ensure env is set for tests
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.OPENAI_MODEL
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
                  name: REVIEW_TOOL_NAME,
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
    // Ensure SDK called with default model and forced tool choice
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5',
        tools: expect.any(Array),
        tool_choice: {
          type: 'function',
          function: { name: REVIEW_TOOL_NAME }
        }
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
                  name: REVIEW_TOOL_NAME,
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

  it('throws when no tool calls are present', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Please see some review notes without tool calls'
          }
        }
      ]
    })

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      `OpenAI did not call required tool ${REVIEW_TOOL_NAME} in inline comment response`
    )
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
                  name: REVIEW_TOOL_NAME,
                  arguments: '{ invalid json'
                }
              }
            ]
          }
        }
      ]
    })

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      'OpenAI tool call returned invalid JSON'
    )
  })

  it('uses temperature=1 for GPT-5 regardless of thinking mode (disabled)', async () => {
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

    // thinking disabled, but GPT-5 requires temperature=1
    await openaiLineCommentsSender('prompt', false)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5',
        temperature: 1 // Should be 1 for GPT-5, not 0
      })
    )
  })

  it('uses temperature=1 for GPT-5 when thinking is enabled', async () => {
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

    // thinking enabled, GPT-5 gets temperature=1
    await openaiLineCommentsSender('prompt', true)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5',
        temperature: 1
      })
    )
  })

  it('uses temperature=0 for non-GPT-5 models when thinking is disabled', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o'
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

    // Other models can use temperature=0 when thinking disabled
    await openaiLineCommentsSender('prompt', false)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        temperature: 0 // Should be 0 for non-GPT-5 models when thinking disabled
      })
    )
  })

  it('respects model-specific temperature overrides from registry', async () => {
    // This test demonstrates that the system is provider-agnostic
    // Any model can be added to the override registry
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

    // The override system forces temperature=1 for GPT-5
    await openaiLineCommentsSender('prompt', false)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 1 // Forced by MODEL_PARAMETER_OVERRIDES registry
      })
    )
  })
})
