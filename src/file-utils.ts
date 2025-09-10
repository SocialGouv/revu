import * as fs from 'fs/promises'
import * as path from 'path'
import type { PlatformClient } from './core/models/platform-types.ts'
import { getRemoteIgnoreInstance } from './ignore-utils.ts'

type DiffLineType = 'addition' | 'deletion' | 'context' | 'header' | 'metadata'

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

/**
 * Filters out files that match patterns in .revuignore using remote file fetching.
 * Uses the ignore library for robust gitignore-style pattern matching.
 * This version fetches the .revuignore file from the remote repository.
 *
 * @param filePaths - Array of file paths to filter
 * @param client - Platform client for fetching remote files
 * @param commitSha - Commit SHA to fetch the .revuignore file from
 * @returns Promise resolving to filtered array of file paths
 */
export async function filterIgnoredFiles(
  filePaths: string[],
  client: PlatformClient,
  commitSha: string
): Promise<string[]> {
  try {
    const ig = await getRemoteIgnoreInstance(client, commitSha)
    // Use the ignore library's filter method to remove ignored files
    return ig.filter(filePaths)
  } catch (error) {
    console.warn(`Error filtering ignored files from remote: ${error.message}`)
    // Return original files if filtering fails
    return filePaths
  }
}

/**
 * Classifies a diff line by its type
 */
export function classifyDiffLine(line: string): DiffLineType {
  if (line.startsWith('diff --git')) return 'header'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'addition'
  if (line.startsWith('-') && !line.startsWith('---')) return 'deletion'
  if (
    line.startsWith('@@') ||
    line.startsWith('index ') ||
    line.startsWith('+++') ||
    line.startsWith('---')
  ) {
    return 'metadata'
  }
  return 'context'
}

/**
 * Extracts filename from a git diff header line
 */
export function extractFileNameFromDiffHeader(line: string): string | null {
  const match = line.match(/^diff --git a\/(.*?) b\/(.*)$/)
  return match ? match[2] : null
}

/**
 * Filters diff lines to only include content from reviewable files.
 * This ensures diff content respects .revuignore patterns and matches
 * the filtered file list used elsewhere in the review pipeline.
 *
 * @param diffLines - Array of diff lines
 * @param reviewableFiles - Array of reviewable file paths (already filtered)
 * @returns Filtered array of diff lines containing only reviewable file content
 */
export function filterDiffToReviewableFiles(
  diffLines: string[],
  reviewableFiles: string[]
): string[] {
  const reviewableFilesSet = new Set(reviewableFiles)
  const filteredLines: string[] = []
  let currentFileName = ''
  let includeCurrentFile = false

  for (const line of diffLines) {
    const lineType = classifyDiffLine(line)

    if (lineType === 'header') {
      // Extract filename and determine if we should include this file
      const fileName = extractFileNameFromDiffHeader(line)
      currentFileName = fileName || ''
      includeCurrentFile = reviewableFilesSet.has(currentFileName)
    }

    // Include line if we're processing a reviewable file
    if (includeCurrentFile) {
      filteredLines.push(line)
    }
  }

  return filteredLines
}
