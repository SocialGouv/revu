import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { populateTemplate } from '../src/populate-template.ts'

describe('populateTemplate', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'
  const configPath = path.join(process.cwd(), 'config.json')
  let originalConfig: string | null = null

  // Save original config before tests
  beforeEach(async () => {
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
      branch: testBranch
    })

    // Verify the template was populated with all required sections
    expect(result).toContain('Project Path:')
    expect(result).toContain('Source Tree:')
    expect(result).toContain('Git diff:')
    expect(result).toContain('Git log:')

    // Verify the content structure
    expect(result).toMatch(/Project Path: .+/)
    expect(result).toMatch(/Source Tree:\n```\n.+\n```/s)
    expect(result).toMatch(/Git diff:\n```\n.+\n```/s)
    expect(result).toMatch(/Git log:\n```\n.+\n```/s)
  }, 60000) // Increase timeout since we're doing git operations

  it('should use custom template path when provided', async () => {
    // Set config to use default strategy
    await fs.writeFile(
      configPath,
      JSON.stringify({ promptStrategy: 'default' })
    )

    // Create a temporary custom template
    const customTemplate = 'Custom template: {{source_tree}}'
    const tempTemplatePath = path.join(process.cwd(), 'test-template.hbs')
    await fs.writeFile(tempTemplatePath, customTemplate)

    try {
      const result = await populateTemplate({
        repositoryUrl: testRepo,
        branch: testBranch,
        templatePath: tempTemplatePath
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
        templatePath: 'nonexistent.hbs'
      })
    ).rejects.toThrow()
  })
})
