import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { openaiLineCommentsSender } from '../../src/senders/providers/openai/line-comments-sender.ts'
import { REVIEW_TOOL_NAME } from '../../src/senders/shared/review-tool-schema.ts'
import { _resetRuntimeConfigCacheForTests } from '../../src/core/utils/runtime-config.ts'

// Mock the OpenAI SDK
const createMock = vi.fn()

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: createMock
    }
  }
  return { default: MockOpenAI }
})

describe('openaiLineCommentsSender', () => {
  beforeEach(async () => {
    vi.resetModules()
    createMock.mockReset()
    _resetRuntimeConfigCacheForTests()
    // Ensure env is set for tests
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL
  })

  it('returns structured JSON string when Responses API returns valid json_schema output', async () => {
    const expected = { summary: 'Looks good', comments: [] }
    createMock.mockResolvedValue({
      output_text: JSON.stringify(expected)
    })

    const result = await openaiLineCommentsSender('test prompt')
    expect(result).toEqual(JSON.stringify(expected))
    // Ensure SDK called with default model and structured outputs config
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5',
        input: 'test prompt',
        text: {
          format: expect.objectContaining({
            type: 'json_schema',
            name: 'code_review'
          })
        }
      })
    )
  })

  it('uses OPENAI_MODEL when provided', async () => {
    process.env.OPENAI_MODEL = 'gpt-5'
    const expected = { summary: 'ok', comments: [] }
    createMock.mockResolvedValue({
      output_text: JSON.stringify(expected)
    })

    const result = await openaiLineCommentsSender('prompt')
    expect(JSON.parse(result)).toEqual(expected)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5'
      })
    )
  })

  it('throws when output_text is missing or empty', async () => {
    createMock.mockResolvedValue({})

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      'OpenAI Responses API did not return output_text for line comments'
    )
  })

  it('throws when output_text has invalid JSON', async () => {
    createMock.mockResolvedValue({
      output_text: '{ invalid json'
    })

    await expect(openaiLineCommentsSender('test prompt')).rejects.toThrow(
      'OpenAI Responses API returned invalid JSON for line comments'
    )
  })

  it('uses temperature=1 for GPT-5 regardless of thinking mode (disabled)', async () => {
    process.env.OPENAI_MODEL = 'gpt-5'
    const expected = { summary: 'ok', comments: [] }
    createMock.mockResolvedValue({
      output_text: JSON.stringify(expected)
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
      output_text: JSON.stringify(expected)
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
      output_text: JSON.stringify(expected)
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
      output_text: JSON.stringify(expected)
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
