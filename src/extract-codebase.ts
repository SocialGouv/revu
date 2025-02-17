import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

const execAsync = promisify(exec)

interface ExtractCodebaseOptions {
  repositoryUrl: string
  branch: string
  tempFolder?: string
}

interface ExtractCodebaseFromRepoOptions {
  branch: string
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
  branch,
  repoPath
}: ExtractCodebaseFromRepoOptions): Promise<string> {
  // Checkout the branch
  await execAsync(`git checkout ${branch}`, { cwd: repoPath })

  // Copy the .aidigestignore file to the repository
  await fs.copyFile('.aidigestignore', path.join(repoPath, '.aidigestignore'))

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

// Keep original function for backward compatibility
/**
 * Legacy function that extracts codebase content from a GitHub repository.
 * Creates a temporary clone of the repository and delegates to extractCodebaseFromRepo.
 *
 * @param {Object} options - The options for extraction
 * @param {string} options.repositoryUrl - The URL of the GitHub repository
 * @param {string} options.branch - The branch to extract from
 * @param {string} [options.tempFolder] - Optional temporary folder path for cloning
 * @returns {Promise<string>} The processed codebase content
 * @throws {Error} If cloning or extraction fails
 * @deprecated Use extractCodebaseFromRepo when repository is already cloned
 */
export async function extractCodebase({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'ai-digest-' + Date.now())
}: ExtractCodebaseOptions): Promise<string> {
  try {
    // Create temporary directory
    await fs.mkdir(tempFolder, { recursive: true })

    // Clone the repository
    await execAsync(
      `git clone --branch ${branch} ${repositoryUrl} ${tempFolder}`
    )

    // Extract codebase using the new function
    const codebase = await extractCodebaseFromRepo({
      branch,
      repoPath: tempFolder
    })

    // Clean up
    await fs.rm(tempFolder, { recursive: true, force: true })

    return codebase
  } catch (error) {
    // Clean up on error
    try {
      await fs.rm(tempFolder, { recursive: true, force: true })
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError)
    }

    throw error
  }
}
