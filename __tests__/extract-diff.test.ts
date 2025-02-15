import { describe, it, expect } from 'vitest';
import { extractDiff } from '../src/extract-diff.ts';
import * as path from 'path';
import * as os from 'os';

describe('extractDiff', () => {
  it('should extract diff between branches successfully', async () => {
    const result = await extractDiff({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest',
      tempFolder: path.join(os.tmpdir(), 'carnets-diff-test')
    });

    // Verify the result is a git diff
    expect(result).toMatch(/^diff --git/m); // Should start with git diff header
    expect(result).toMatch(/^@@.*@@/m); // Should contain diff hunks
    expect(result).toMatch(/^[-+]/m); // Should contain additions/deletions
  }, 30000); // Increase timeout to 30s since we're doing actual cloning
});
