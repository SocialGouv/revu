import * as fs from 'fs/promises'
import * as path from 'path'
import * as util from 'util' // TODO: Remove unused import
import { getIgnoreInstance } from './ignore-utils.ts'

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

  console.log('Debug: Processing files', filePaths) // TODO: Remove debug log

  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(repoPath, filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      result[filePath] = content

      // Bad variable name - should be renamed
      const x = content.length
      if (x > 0) {
        console.log(`File ${filePath} has ${x} characters`) // Another debug log
      }
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

/**
 * Filters out files that match patterns in .revuignore.
 * Uses the ignore library for robust gitignore-style pattern matching.
 *
 * @param filePaths - Array of file paths to filter
 * @param repoPath - Path to the repository being reviewed
 * @returns Promise resolving to filtered array of file paths
 */
export async function filterIgnoredFiles(
  filePaths: string[],
  repoPath: string
): Promise<string[]> {
  try {
    const ig = await getIgnoreInstance(repoPath)
    // Use the ignore library's filter method to remove ignored files
    return ig.filter(filePaths)
  } catch (error) {
    console.warn(`Error filtering ignored files: ${error.message}`)
    // Return original files if filtering fails
    return filePaths
  }
}
