import { describe, it, expect } from 'vitest';
import { extractAll } from './extract-all.ts';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

describe('extractAll', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git';
  const testBranch = 'ai-digest';
  const testFolder = path.join(os.tmpdir(), 'carnets-all-test');

  it('should extract all information from a single clone', async () => {
    const result = await extractAll({
      repositoryUrl: testRepo,
      branch: testBranch,
      tempFolder: testFolder
    });

    // Verify codebase contains expected content
    expect(result.codebase).toBeTruthy();
    expect(result.codebase).toContain('```'); // Should contain code blocks

    // Verify diff has correct git diff format
    expect(result.diff).toBeTruthy();
    expect(result.diff).toMatch(/^diff --git/m); // Should start with git diff header
    expect(result.diff).toMatch(/^@@.*@@/m); // Should contain diff hunks
    expect(result.diff).toMatch(/^[-+]/m); // Should contain additions/deletions

    // Verify log has correct git log format
    expect(result.log).toBeTruthy();
    expect(result.log).toMatch(/[a-f0-9]+ - .+, .+ : .+/); // Should match git log format
  }, 60000); // Increase timeout to 60s since we're doing three operations

  it('should clean up the temporary directory', async () => {
    await extractAll({
      repositoryUrl: testRepo,
      branch: testBranch,
      tempFolder: testFolder
    });

    // Verify the temp folder is cleaned up
    await expect(fs.access(testFolder)).rejects.toThrow();
  });

  it('should clean up even if an operation fails', async () => {
    // Use a non-existent repository to force a failure
    await expect(extractAll({
      repositoryUrl: 'https://github.com/nonexistent/repo.git',
      branch: 'main',
      tempFolder: testFolder
    })).rejects.toThrow();

    // Verify the temp folder is cleaned up
    await expect(fs.access(testFolder)).rejects.toThrow();
  });
});
