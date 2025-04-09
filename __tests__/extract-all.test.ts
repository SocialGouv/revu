import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractAll } from '../src/extract-all.ts'
import { cleanUpRepository, prepareRepository } from '../src/repo-utils.ts'

describe('extractAll', async () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'
  let repoPath: string

  beforeEach(async () => {
    repoPath = await prepareRepository(testRepo, testBranch)
  })

  afterEach(async () => {
    await cleanUpRepository(repoPath)
  })

  it('should extract all information from a single clone', async () => {
    const result = await extractAll({
      branch: testBranch,
      repoPath: repoPath
    })

    // Verify codebase contains expected content
    expect(result.codebase).toBeTruthy()
    expect(result.codebase).toContain('```') // Should contain code blocks

    // Verify diff has correct git diff format
    expect(result.diff).toBeTruthy()
    expect(result.diff).toMatch(/^diff --git/m) // Should start with git diff header
    expect(result.diff).toMatch(/^@@.*@@/m) // Should contain diff hunks
    expect(result.diff).toMatch(/^[-+]/m) // Should contain additions/deletions

    // Verify log has correct git log format
    expect(result.log).toBeTruthy()
    expect(result.log).toMatch(/[a-f0-9]+ - .+, .+ : .+/) // Should match git log format
  }, 60000) // Increase timeout to 60s since we're doing three operations
})
