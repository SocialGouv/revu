import { describe, expect, it, vi } from 'vitest'
import { sendToAnthropic } from '../src/send-to-anthropic.ts'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreateResponse = {
    content: [{ type: 'text', text: 'Mocked API response' }]
  }

  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue(mockCreateResponse)
      }
      beta = {
        messages: {
          create: vi.fn().mockResolvedValue(mockCreateResponse)
        }
      }
    }
  }
})

// Mock the template population
vi.mock('../src/populate-template.ts', () => ({
  populateTemplate: vi.fn().mockResolvedValue('Mocked template content')
}))

// Force provider to Anthropic for this test
vi.mock('../src/core/utils/config-loader.ts', () => ({
  getAppConfig: vi.fn().mockResolvedValue({
    promptStrategy: 'line-comments',
    thinkingEnabled: false,
    llmProvider: 'anthropic'
  })
}))

describe('sendToAnthropic', () => {
  it('should send prompt to Anthropic API and return response', async () => {
    const mockContext = {
      repoOwner: 'SocialGouv',
      repoName: 'carnets',
      client: {
        fetchPullRequestDiff: vi.fn(),
        fetchIssueDetails: vi.fn(),
        cloneRepository: vi.fn(),
        createReview: vi.fn(),
        createReviewComment: vi.fn(),
        updateReviewComment: vi.fn(),
        getPullRequest: vi.fn(),
        listReviewComments: vi.fn(),
        getReviewComment: vi.fn(),
        deleteReviewComment: vi.fn(),
        fetchPullRequestDiffMap: vi.fn(),
        getFileContent: vi.fn(),
        listReviews: vi.fn()
      }
    }

    const result = await sendToAnthropic({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest',
      context: mockContext
    })

    expect(result).toEqual('Mocked API response')
  })
})
