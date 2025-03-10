import { exec } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)
/**
 * Prepares a repository for extraction by cloning it and fetching all branches.
 *
 * @param {string} repositoryUrl - The URL of the GitHub repository to clone
 * @param {string} tempFolder - The folder path where the repository will be cloned
 * @returns {Promise<string>} Path to the prepared repository
 * @throws {Error} If cloning or fetching fails
 */
export async function prepareRepository(
  repositoryUrl: string,
  branch: string,
  tempFolder = path.join(os.tmpdir(), 'revu-all-' + Date.now())
): Promise<string> {
  // Create temporary directory, deleting it first if it already exists
  try {
    await fs.rm(tempFolder, { recursive: true, force: true })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Ignore errors if folder doesn't exist
  }
  await fs.mkdir(tempFolder, { recursive: true })

  // Clone the repository with all branches
  await execAsync(`git clone ${repositoryUrl} ${tempFolder}`)

  // Fetch all branches
  await execAsync('git fetch --all', { cwd: tempFolder })

  // Checkout the branch
  await execAsync(`git checkout ${branch}`, { cwd: tempFolder })

  // Copy the .aidigestignore file to the repository
  await fs.copyFile('.aidigestignore', path.join(tempFolder, '.aidigestignore'))

  return tempFolder
}
