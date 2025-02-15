import * as fs from 'fs/promises';
import * as path from 'path';
import Handlebars from 'handlebars';
import { extractAll } from './extract-all.ts';

interface PopulateTemplateOptions {
  repositoryUrl: string;
  branch: string;
  templatePath?: string;
}

export async function populateTemplate({
  repositoryUrl,
  branch,
  templatePath = path.join(process.cwd(), 'templates', 'prompt.hbs')
}: PopulateTemplateOptions): Promise<string> {
  // Read and compile the template
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  const template = Handlebars.compile(templateContent);

  // Extract all the required data
  const { codebase, diff, log } = await extractAll({
    repositoryUrl,
    branch
  });

  // Get the absolute path of the repository
  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || '';
  const absolutePath = path.join(process.cwd(), repoName);

  // Populate the template with the data
  const result = template({
    absolute_code_path: absolutePath,
    source_tree: codebase,
    git_diff_branch: diff,
    git_log_branch: log
  });

  return result;
}
