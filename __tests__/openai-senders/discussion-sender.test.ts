import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { discussionSender } from '../../src/senders/providers/openai/discussion-sender.ts'

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

describe('openai discussionSender', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset()
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL
  })

  it('uses max_output_tokens for gpt-5 by default (thinking disabled)', async () => {
    createMock.mockResolvedValue({
      output_text: 'Test reply',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15
      }
    })

    const result = await discussionSender('test prompt', false)

    expect(result).toBe('Test reply')
    expect(createMock).toHaveBeenCalledTimes(1)

    const callArgs = createMock.mock.calls[0][0]
    expect(callArgs).toMatchObject({
      model: 'gpt-5',
      input: [
        {
          role: 'user',
          content: expect.any(String)
        }
      ]
    })
    expect(callArgs.max_output_tokens).toBe(1024)
    expect(callArgs.reasoning).toMatchObject({ effort: 'low' })
    expect(callArgs.text).toMatchObject({
      format: { type: 'text' },
      verbosity: 'low'
    })
  })

  it('increases max_output_tokens and reasoning effort when thinking is enabled', async () => {
    createMock.mockResolvedValue({
      output_text: 'Thinking reply',
      usage: {
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30
      }
    })

    const result = await discussionSender('test prompt', true)

    expect(result).toBe('Thinking reply')
    expect(createMock).toHaveBeenCalledTimes(1)

    const callArgs = createMock.mock.calls[0][0]
    expect(callArgs.model).toBe('gpt-5')
    expect(callArgs.max_output_tokens).toBe(2048)
    expect(callArgs.reasoning).toMatchObject({ effort: 'medium' })
  })

  it('uses OPENAI_MODEL env var when provided', async () => {
    process.env.OPENAI_MODEL = 'gpt-5'

    createMock.mockResolvedValue({
      output_text: 'Env model reply'
    })

    const result = await discussionSender('another prompt', false)

    expect(result).toBe('Env model reply')
    expect(createMock).toHaveBeenCalledTimes(1)

    const callArgs = createMock.mock.calls[0][0]
    expect(callArgs.model).toBe('gpt-5')
    expect(callArgs.max_output_tokens).toBe(1024)
  })

  it('returns empty string when the model returns empty content and no retry condition', async () => {
    createMock.mockResolvedValue({
      status: 'completed',
      output_text: ''
    })

    const result = await discussionSender('empty', false)

    expect(result).toBe('')
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('handles array-style content by concatenating text parts (fallback path)', async () => {
    // Simulate a response without output_text, but with a structured output array
    createMock.mockResolvedValue({
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Part 1. ' },
            { type: 'output_text', text: 'Part 2.' }
          ]
        }
      ]
    })

    const result = await discussionSender('array prompt', false)

    expect(result).toBe('Part 1. Part 2.')
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('retries once when the first response is reasoning-only and max_output_tokens is reached', async () => {
    createMock
      .mockResolvedValueOnce({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output_text: ''
      })
      .mockResolvedValueOnce({
        output_text: 'Follow-up reply'
      })

    const result = await discussionSender('needs followup', false)

    expect(result).toBe('Follow-up reply')
    expect(createMock).toHaveBeenCalledTimes(2)

    const firstCall = createMock.mock.calls[0][0]
    const secondCall = createMock.mock.calls[1][0]

    expect(firstCall.max_output_tokens).toBe(1024)
    expect(secondCall.max_output_tokens).toBe(256)
    expect(secondCall.reasoning).toMatchObject({ effort: 'low' })
  })
})
