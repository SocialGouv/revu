import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { extractAllFromUrl } from '../extract-all.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Default prompt generation strategy.
 * Uses a Handlebars template to generate a prompt with repository data.
 * This strategy extracts the full repository data and uses it to populate the template.
 *
 * @param repositoryUrl - The URL of the GitHub repository
 * @param branch - The branch to analyze
 * @param templatePath - Optional path to a custom template file
 * @param token - Optional GitHub access token for private repositories
 * @returns A promise that resolves to the generated prompt string
 */
export const defaultPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  templatePath?: string,
  token?: string
): Promise<string> => {
  // Extract all data with token support for private repositories
  const { codebase, diff, log } = await extractAllFromUrl({
    repositoryUrl,
    branch,
    token
  })

  // Get the absolute path of the repository
  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''
  const absolutePath = path.join(process.cwd(), repoName)

  // Read and compile the template
  const actualTemplatePath =
    templatePath || path.join(process.cwd(), 'templates', 'prompt.hbs')
  const templateContent = await fs.readFile(actualTemplatePath, 'utf-8')
  const template = Handlebars.compile(templateContent)

  // Populate the template with the data
  const result = template({
    absolute_code_path: absolutePath,
    source_tree: codebase,
    git_diff_branch: diff,
    git_log_branch: log
  })

  return result
}
