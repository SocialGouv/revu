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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      continue // Ignore errors for individual files
    }
  }

  return result
}

/**
 * Extracts modified file paths from the git diff.
 *
 * @param diff - Git diff output
 * @returns Array of modified file paths
 */
export function extractModifiedFilePaths(diff: string): string[] {
  const modifiedFiles = new Set<string>()

  // Regular expression to match file paths in diff
  const filePathRegex = /^diff --git a\/(.*?) b\/(.*?)$/gm
  let match

  while ((match = filePathRegex.exec(diff)) !== null) {
    // Use the 'b' path (new file path)
    modifiedFiles.add(match[2])
  }

  return Array.from(modifiedFiles)
}
