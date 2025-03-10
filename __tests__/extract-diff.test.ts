import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { extractDiffFromRepo } from '../src/extract-diff.ts'

describe('extractDiffFromRepo', () => {
  it('should extract diff between branches successfully', async () => {
    const result = await extractDiffFromRepo({
      branch: 'ai-digest',
      repoPath: path.join(os.tmpdir(), 'carnets-diff-test')
    })

    // Verify the result is a git diff
    expect(result).toMatch(/^diff --git/m) // Should start with git diff header
    expect(result).toMatch(/^@@.*@@/m) // Should contain diff hunks
    expect(result).toMatch(/^[-+]/m) // Should contain additions/deletions
  }, 30000) // Increase timeout to 30s since we're doing actual cloning
})
