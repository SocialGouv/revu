import { describe, expect, it } from 'vitest'
import { extractCodebaseFromRepo } from '../src/extract-codebase.ts'
import { prepareRepository } from '../src/repo-utils.ts'

describe('extractCodebaseFromRepo', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'

  it('should extract carnets codebase successfully', async () => {
    const repoPath = await prepareRepository(testRepo, testBranch)
    const result = await extractCodebaseFromRepo({
      repoPath: repoPath
    })

    // Verify the result contains expected content
    // expect(result).toContain('# Files included in the output');
    expect(result).toContain('package.json')
    expect(result).toContain('src/')

    // Verify markdown formatting
    expect(result).toMatch(/```[a-z]*\n[\s\S]*?\n```/) // Should contain code blocks

    // Verify it respects .aidigestignore by checking no files from ignored directories are included
    expect(result).not.toMatch(/^# node_modules\//m)
    expect(result).not.toMatch(/^# \.next\//m)
    expect(result).not.toMatch(/^# coverage\//m)
  }, 30000) // Increase timeout to 30s since we're doing actual cloning
})
