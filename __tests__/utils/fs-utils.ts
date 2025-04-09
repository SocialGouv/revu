import * as fs from 'fs/promises'
import path from 'path'

/**
 * Checks if a directory exists
 * @param dir Path to the directory
 * @returns Promise resolving to true if the directory exists, false otherwise
 */
export async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dir)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Checks if a file exists
 * @param filePath Path to the file
 * @returns Promise resolving to true if the file exists, false otherwise
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Checks if a directory is a git repository
 * @param dir Path to the directory
 * @returns Promise resolving to true if the directory is a git repository, false otherwise
 */
export async function isGitRepository(dir: string): Promise<boolean> {
  return await directoryExists(path.join(dir, '.git'))
}
