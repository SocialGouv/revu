import { describe, it, expect, vi } from 'vitest'
import { sendToAnthropic } from '../src/send-to-anthropic.ts'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Mocked API response' }]
        })
      }
    }
  }
})

// Mock the template population
vi.mock('../src/populate-template.ts', () => ({
  populateTemplate: vi.fn().mockResolvedValue('Mocked template content')
}))

describe('sendToAnthropic', () => {
  it('should send prompt to Anthropic API and return response', async () => {
    const result = await sendToAnthropic({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest'
    })

    expect(result).toEqual('Mocked API response')
  })
})
