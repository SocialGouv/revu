import { describe, it, expect } from 'vitest';
import { extractCodebase } from './extract-codebase.ts';
import * as path from 'path';
import * as os from 'os';

describe('extractCodebase', () => {
  it('should extract carnets codebase successfully', async () => {
    const result = await extractCodebase({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest',
      tempFolder: path.join(os.tmpdir(), 'carnets-test')
    });

    // Verify the result contains expected content
    // expect(result).toContain('# Files included in the output');
    expect(result).toContain('package.json');
    expect(result).toContain('src/');
    
    // Verify markdown formatting
    expect(result).toMatch(/```[a-z]*\n[\s\S]*?\n```/); // Should contain code blocks
    
    // Verify it respects .aidigestignore by checking no files from ignored directories are included
    expect(result).not.toMatch(/^# node_modules\//m);
    expect(result).not.toMatch(/^# \.next\//m);
    expect(result).not.toMatch(/^# coverage\//m);
  }, 30000); // Increase timeout to 30s since we're doing actual cloning
});
