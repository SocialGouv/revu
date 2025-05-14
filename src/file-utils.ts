import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * Gets content of files.
 *
 * @param filePaths - Array of file paths
 * @param repoPath - Absolute path to the repository
 * @returns Object mapping file paths to their content
 */
export async function getFilesContent(
  filePaths: string[],
  repoPath: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(repoPath, filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      result[filePath] = content
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error)
      result[filePath] = `Error reading file: ${error}`
    }
  }

  return result
}
