import type { DiffFileMap, DiffHunk, DiffInfo } from '../models/diff-types.ts'

/**
 * Parses hunk header to extract metadata
 * @param hunk Raw hunk string
 * @returns Parsed hunk header information or null if invalid
 */
function parseHunkHeader(
  hunk: string
): { header: string; startLine: number; lineCount: number } | null {
  const hunkHeaderMatch = hunk.match(/^[ -+](-\d+,\d+ \+\d+,\d+) @@(.*)/)
  if (!hunkHeaderMatch) return null

  const hunkHeader = `@@${hunkHeaderMatch[1]} @@${hunkHeaderMatch[2] || ''}`

  // Parse the hunk range for new file (+)
  const newRangeMatch = hunkHeaderMatch[1].match(/\+(\d+),?(\d+)?/)
  if (!newRangeMatch) return null

  const startLine = parseInt(newRangeMatch[1], 10)
  const lineCount = parseInt(newRangeMatch[2] || '1', 10)

  return { header: hunkHeader, startLine, lineCount }
}

/**
 * Processes lines within a hunk to identify changed lines
 * @param lines Array of hunk lines
 * @param startLine Starting line number for the hunk
 * @returns Set of changed line numbers
 */
function processHunkLines(lines: string[], startLine: number): Set<number> {
  const changedLines = new Set<number>()
  let currentLineNumber = startLine

  // Process each line in the hunk to track changed lines
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]

    // Skip removed lines (they don't exist in the new file)
    if (line.startsWith('-')) continue

    // For added lines, track the line number
    if (line.startsWith('+')) {
      changedLines.add(currentLineNumber)
    }

    // Increment line number for context and added lines
    if (line.startsWith('+') || !line.startsWith('-')) {
      currentLineNumber++
    }
  }

  return changedLines
}

/**
 * Processes a single hunk to extract hunk info and changed lines
 * @param hunk Raw hunk string
 * @returns Hunk information and changed lines, or null if invalid
 */
function processHunk(
  hunk: string
): { hunkInfo: DiffHunk; changedLines: Set<number> } | null {
  const headerInfo = parseHunkHeader(hunk)
  if (!headerInfo) return null

  const { header, startLine, lineCount } = headerInfo
  const endLine = startLine + lineCount - 1

  // Split hunk into lines and process them
  const lines = hunk.split('\n')
  const changedLines = processHunkLines(lines, startLine)

  const hunkInfo: DiffHunk = {
    startLine,
    endLine,
    header
  }

  return { hunkInfo, changedLines }
}

/**
 * Parses a single file section from the diff
 * @param section Raw file section string
 * @returns File path and diff info, or null if invalid
 */
function parseFileSection(
  section: string
): { filePath: string; diffInfo: DiffInfo } | null {
  // Extract file path
  const filePathMatch = section.match(/a\/(.+?) b\//)
  if (!filePathMatch) return null

  const filePath = filePathMatch[1]
  const allChangedLines = new Set<number>()
  const hunks: DiffHunk[] = []

  // Extract hunks
  const hunkSections = section.split('\n@@').slice(1)

  for (const hunk of hunkSections) {
    const result = processHunk(hunk)
    if (!result) continue

    const { hunkInfo, changedLines } = result

    // Merge changed lines from this hunk
    changedLines.forEach((line) => allChangedLines.add(line))
    hunks.push(hunkInfo)
  }

  return {
    filePath,
    diffInfo: { changedLines: allChangedLines, hunks }
  }
}

/**
 * Parses a git diff to extract changed lines and their hunks
 * @param diff Git diff string
 * @returns Map of file paths to their diff information
 */
export function parseDiff(diff: string): DiffFileMap {
  const fileMap = new Map<string, DiffInfo>()
  const fileSections = diff.split('diff --git ').slice(1)

  for (const section of fileSections) {
    const result = parseFileSection(section)
    if (result) {
      fileMap.set(result.filePath, result.diffInfo)
    }
  }

  return fileMap
}
