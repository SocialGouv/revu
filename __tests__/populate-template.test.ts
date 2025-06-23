import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { populateTemplate } from '../src/populate-template.ts'
import type { PromptContext } from '../src/prompt-strategies/prompt-strategy.ts'

// Mock the fetchPrDiff function
vi.mock('../src/extract-diff.ts', () => ({
  fetchPrDiff: vi.fn()
}))

// Import the mocked function after the mock setup
import { fetchPrDiff } from '../src/extract-diff.ts'
const mockFetchPrDiff = vi.mocked(fetchPrDiff)

describe('populateTemplate', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'
  const configPath = path.join(process.cwd(), 'config.json')
  let originalConfig: string | null = null

  // Create a minimal mock context for tests that need it
  const mockContext: PromptContext = {
    githubContext: {
      repo: () => ({ owner: 'test-owner', repo: 'test-repo' }),
      octokit: {
        request: vi.fn().mockResolvedValue({
          data: 'diff --git a/test.js b/test.js\nindex 1234567..abcdefg 100644\n--- a/test.js\n+++ b/test.js\n@@ -1,3 +1,4 @@\n console.log("hello")\n+console.log("world")\n'
        })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    prNumber: 123
  }

  // Save original config before tests
  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup default mock for fetchPrDiff
    mockFetchPrDiff.mockResolvedValue(
      'diff --git a/test.js b/test.js\nindex 1234567..abcdefg 100644\n--- a/test.js\n+++ b/test.js\n@@ -1,3 +1,4 @@\n console.log("hello")\n+console.log("world")\n'
    )

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
    expect(result).toMatch(/## Context\n+/)
    expect(result).toMatch(/## Modified Files\n+/)
    expect(result).toMatch(/## Git Diff\n+/)

    // Verify that fetchPrDiff was called with the correct parameters
    expect(mockFetchPrDiff).toHaveBeenCalledWith(
      mockContext.githubContext,
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
    const customTemplate = 'Custom template: {{git_diff_branch}}'
    const tempTemplatePath = path.join(process.cwd(), 'test-template.hbs')
    await fs.writeFile(tempTemplatePath, customTemplate)

    try {
      const result = await populateTemplate({
        repositoryUrl: testRepo,
        branch: testBranch,
        templatePath: tempTemplatePath,
        context: mockContext
      })

      console.log(`result`, result)
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
