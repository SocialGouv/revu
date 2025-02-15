import { describe, it, expect } from 'vitest';
import { populateTemplate } from '../src/populate-template.ts';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('populateTemplate', () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git';
  const testBranch = 'ai-digest';

  it('should populate the template with repository data', async () => {
    const result = await populateTemplate({
      repositoryUrl: testRepo,
      branch: testBranch
    });

    // Verify the template was populated with all required sections
    expect(result).toContain('Project Path:');
    expect(result).toContain('Source Tree:');
    expect(result).toContain('Git diff:');
    expect(result).toContain('Git log:');
    
    // Verify the content structure
    expect(result).toMatch(/Project Path: .+/);
    expect(result).toMatch(/Source Tree:\n\`\`\`\n.+\n\`\`\`/s);
    expect(result).toMatch(/Git diff:\n\`\`\`\n.+\n\`\`\`/s);
    expect(result).toMatch(/Git log:\n\`\`\`\n.+\n\`\`\`/s);
  }, 60000); // Increase timeout since we're doing git operations

  it('should use custom template path when provided', async () => {
    // Create a temporary custom template
    const customTemplate = 'Custom template: {{source_tree}}';
    const tempTemplatePath = path.join(process.cwd(), 'test-template.hbs');
    await fs.writeFile(tempTemplatePath, customTemplate);

    try {
      const result = await populateTemplate({
        repositoryUrl: testRepo,
        branch: testBranch,
        templatePath: tempTemplatePath
      });

      expect(result).toContain('Custom template:');
      expect(result).toMatch(/Custom template: .+/);
    } finally {
      // Clean up
      await fs.unlink(tempTemplatePath);
    }
  }, 60000);

  it('should handle missing template gracefully', async () => {
    await expect(populateTemplate({
      repositoryUrl: testRepo,
      branch: testBranch,
      templatePath: 'nonexistent.hbs'
    })).rejects.toThrow();
  });
});
