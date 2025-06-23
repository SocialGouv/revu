import { exec } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

interface ExtractCodebaseFromRepoOptions {
  repoPath: string
}

/**
 * Extracts codebase content from an already cloned repository.
 * This function:
 * 1. Checks out the specified branch
 * 2. Uses ai-digest to process the repository content
 * 3. Handles temporary file management
 *
 * @param {Object} options - The options for extraction
 * @param {string} options.branch - The branch to extract from
 * @param {string} options.repoPath - Path to the cloned repository
 * @returns {Promise<string>} The processed codebase content
 * @throws {Error} If extraction or file operations fail
 */
export async function extractCodebaseFromRepo({
  repoPath
}: ExtractCodebaseFromRepoOptions): Promise<string> {
  // Create a temporary file for the output
  const tempOutputFile = path.join(repoPath, 'codebase.md')

  // Run ai-digest on the repository
  await execAsync(
    `npx ai-digest --input ${repoPath} --output ${tempOutputFile}`
  )

  // Read the generated file
  const codebase = await fs.readFile(tempOutputFile, 'utf-8')

  // Clean up the temporary file
  await fs.rm(tempOutputFile)
  await fs.rm(path.join(repoPath, '.aidigestignore'))

  return codebase
}
