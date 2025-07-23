import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlatformClient,
  PlatformContext
} from '../src/core/models/platform-types.ts'
import { populateTemplate } from '../src/populate-template.ts'

describe('populateTemplate', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'
  const configPath = path.join(process.cwd(), 'config.json')
  let originalConfig: string | null = null

  // Create a mock platform client
  const mockClient: PlatformClient = {
    fetchPullRequestDiff: vi
      .fn()
      .mockResolvedValue(
        'diff --git a/test.js b/test.js\nindex 1234567..abcdefg 100644\n--- a/test.js\n+++ b/test.js\n@@ -1,3 +1,4 @@\n console.log("hello")\n+console.log("world")\n'
      ),
    fetchIssueDetails: vi.fn().mockResolvedValue(null),
    cloneRepository: vi.fn().mockResolvedValue(undefined),
    createReview: vi.fn().mockResolvedValue(undefined),
    createReviewComment: vi.fn().mockResolvedValue(undefined),
    updateReviewComment: vi.fn().mockResolvedValue(undefined),
    getPullRequest: vi.fn().mockResolvedValue({
      head: { sha: 'mock-commit-sha-123' },
      number: 123,
      state: 'open',
      mergeable: true,
      title: 'Mock PR Title',
      body: 'Mock PR Body'
    }),
    listReviewComments: vi.fn().mockResolvedValue([]),
    getReviewComment: vi.fn().mockResolvedValue(null),
    deleteReviewComment: vi.fn().mockResolvedValue(undefined),
    fetchPullRequestDiffMap: vi.fn().mockResolvedValue({}),
    getFileContent: vi
      .fn()
      .mockResolvedValue('# Mock .revuignore content\n*.log\n*.tmp\n'),
    listReviews: vi.fn().mockResolvedValue([])
  }

  // Create a minimal mock context for tests that need it
  const mockContext: PlatformContext = {
    repoOwner: 'test-owner',
    repoName: 'test-repo',
    prNumber: 123,
    prTitle: 'Test PR',
    prBody: 'Test PR body',
    client: mockClient
  }

  // Save original config before tests
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()

    try {
      if (fsSync.existsSync(configPath)) {
        originalConfig = await fs.readFile(configPath, 'utf-8')
      }
    } catch (error) {
      console.error('Error reading original config:', error)
    }
  })

  // Restore original config after tests
  afterEach(async () => {
    try {
      if (originalConfig !== null) {
        await fs.writeFile(configPath, originalConfig)
      } else if (fsSync.existsSync(configPath)) {
        await fs.unlink(configPath)
      }
    } catch (error) {
      console.error('Error restoring original config:', error)
    }
  })

  it('should populate the template with repository data using the default strategy', async () => {
    // Set config to use default strategy
    await fs.writeFile(
      configPath,
      JSON.stringify({ promptStrategy: 'default' })
    )

    const result = await populateTemplate({
      repositoryUrl: testRepo,
      branch: testBranch,
      context: mockContext
    })

    // Verify the content structure
    expect(result).toMatch(/## Context/)
    expect(result).toMatch(/## Modified Files/)
    expect(result).toMatch(/## Git Diff/)

    // Verify that the platform client was called with the correct parameters
    expect(mockClient.fetchPullRequestDiff).toHaveBeenCalledWith(
      mockContext.prNumber
    )
  }, 60000) // Increase timeout since we're doing git operations

  it('should use custom template path when provided', async () => {
    // Set config to use default strategy
    await fs.writeFile(
      configPath,
      JSON.stringify({ promptStrategy: 'default' })
    )

    // Create a temporary custom template
    const customTemplate = 'Custom template: {{pr_git_diff}}'
    const tempTemplatePath = path.join(process.cwd(), 'test-template.hbs')
    await fs.writeFile(tempTemplatePath, customTemplate)

    try {
      const result = await populateTemplate({
        repositoryUrl: testRepo,
        branch: testBranch,
        templatePath: tempTemplatePath,
        context: mockContext
      })

      expect(result).toMatch(/Custom template: .+/)
    } finally {
      // Clean up
      await fs.unlink(tempTemplatePath)
    }
  }, 60000)

  it('should handle missing template gracefully', async () => {
    // Set config to use default strategy
    await fs.writeFile(
      configPath,
      JSON.stringify({ promptStrategy: 'default' })
    )

    await expect(
      populateTemplate({
        repositoryUrl: testRepo,
        branch: testBranch,
        templatePath: 'nonexistent.hbs',
        context: mockContext
      })
    ).rejects.toThrow()
  })
})
