import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { extractAll } from '../extract-all.ts'
import { prepareRepository } from '../prepare-repository.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Default prompt generation strategy.
 * Uses a Handlebars template to generate a prompt with repository data.
 * This strategy extracts the full repository data and uses it to populate the template.
 *
 * @param repositoryUrl - The URL of the GitHub repository
 * @param branch - The branch to analyze
 * @param templatePath - Optional path to a custom template file
 * @returns A promise that resolves to the generated prompt string
 */
export const defaultPromptStrategy: PromptStrategy = async (
  repositoryUrl: string,
  branch: string,
  templatePath?: string
): Promise<string> => {
  // Prepare the repository for extraction
  const repoPath = await prepareRepository(repositoryUrl, branch)
  // Extract all the required data
  const { codebase, diff, log } = await extractAll({
    branch,
    repoPath
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
