import { describe, it, expect } from 'vitest';
import { extractCodebase } from './extract-codebase.ts';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

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
    
    // Verify it respects .aidigestignore
    expect(result).not.toContain('node_modules/');
    expect(result).not.toContain('.next/');
    expect(result).not.toContain('coverage/');
  }, 30000); // Increase timeout to 30s since we're doing actual cloning

  it('should write codebase to a file in temp directory', async () => {
    const outputFile = path.join(os.tmpdir(), 'codebase-output-test.md');
    
    const result = await extractCodebase({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest',
      tempFolder: path.join(os.tmpdir(), 'carnets-write-test')
    });

    // Write the result to a file
    await fs.writeFile(outputFile, result, 'utf-8');

    // Verify the file exists and has content
    const fileContent = await fs.readFile(outputFile, 'utf-8');
    expect(fileContent).toBe(result);
    
    // Clean up
    await fs.unlink(outputFile);
  }, 30000);
});
