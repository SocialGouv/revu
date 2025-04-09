import { describe, expect, it } from 'vitest'
import { extractDiffFromRepo } from '../src/extract-diff.ts'
import { prepareRepository } from '../src/repo-utils.ts'

describe('extractDiffFromRepo', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'
  it('should extract diff between branches successfully', async () => {
    const repoPath = await prepareRepository(testRepo, testBranch)

    const result = await extractDiffFromRepo({
      branch: testBranch,
      repoPath: repoPath
    })

    // Verify the result is a git diff
    expect(result).toMatch(/^diff --git/m) // Should start with git diff header
    expect(result).toMatch(/^@@.*@@/m) // Should contain diff hunks
    expect(result).toMatch(/^[-+]/m) // Should contain additions/deletions
  }, 30000) // Increase timeout to 30s since we're doing actual cloning
})
