import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { extractAll } from './extract-all.ts'

interface PopulateTemplateOptions {
  repositoryUrl: string
  branch: string
  templatePath?: string
}

/**
 * Populates a Handlebars template with repository data for Anthropic analysis.
 * This function:
 * 1. Reads and compiles the Handlebars template
 * 2. Extracts repository data (codebase, diff, log)
 * 3. Combines the data with the template
 *
 * @param {Object} options - The options for template population
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch to analyze
 * @param {string} [options.templatePath] - Optional path to the Handlebars template
 * @returns {Promise<string>} The populated template ready for Anthropic analysis
 * @throws {Error} If template reading or data extraction fails
 */
export async function populateTemplate({
  repositoryUrl,
  branch,
  templatePath = path.join(process.cwd(), 'templates', 'prompt.hbs')
}: PopulateTemplateOptions): Promise<string> {
  // Read and compile the template
  const templateContent = await fs.readFile(templatePath, 'utf-8')
  const template = Handlebars.compile(templateContent)

  // Extract all the required data
  const { codebase, diff, log } = await extractAll({
    repositoryUrl,
    branch
  })

  // Get the absolute path of the repository
  const repoName = repositoryUrl.split('/').pop()?.replace('.git', '') || ''
  const absolutePath = path.join(process.cwd(), repoName)

  // Populate the template with the data
  const result = template({
    absolute_code_path: absolutePath,
    source_tree: codebase,
    git_diff_branch: diff,
    git_log_branch: log
  })

  return result
}
