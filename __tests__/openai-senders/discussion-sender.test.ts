import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { discussionSender } from '../../src/senders/providers/openai/discussion-sender.ts'

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

  it('uses max_completion_tokens for gpt-5 by default (thinking disabled)', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Test reply'
          }
        }
      ],
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
      messages: [
        {
          role: 'user',
          content: expect.any(String)
        }
      ]
    })
    expect(callArgs.max_completion_tokens).toBe(1024)
    expect(callArgs).not.toHaveProperty('max_tokens')
    expect(callArgs).not.toHaveProperty('temperature')
  })

  it('increases max_completion_tokens when thinking is enabled', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Thinking reply'
          }
        }
      ],
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
    expect(callArgs.max_completion_tokens).toBe(2048)
    expect(callArgs).not.toHaveProperty('max_tokens')
    expect(callArgs).not.toHaveProperty('temperature')
  })

  it('uses OPENAI_MODEL env var when provided', async () => {
    process.env.OPENAI_MODEL = 'gpt-5'

    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Env model reply'
          }
        }
      ]
    })

    const result = await discussionSender('another prompt', false)

    expect(result).toBe('Env model reply')
    expect(createMock).toHaveBeenCalledTimes(1)

    const callArgs = createMock.mock.calls[0][0]
    expect(callArgs.model).toBe('gpt-5')
    expect(callArgs.max_completion_tokens).toBe(1024)
  })

  it('retries once when the first reply is empty and returns the second reply', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: ''
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Second attempt reply'
            }
          }
        ]
      })

    const result = await discussionSender('needs retry', false)

    expect(result).toBe('Second attempt reply')
    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it('returns empty string when both attempts produce empty replies', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: ''
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: ''
            }
          }
        ]
      })

    const result = await discussionSender('still empty', false)

    expect(result).toBe('')
    expect(createMock).toHaveBeenCalledTimes(2)
  })
})
