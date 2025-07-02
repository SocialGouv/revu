import type { DiffFileMap, DiffInfo } from '../models/diff-types.ts'

/**
 * Parses a git diff to extract changed lines and their hunks
 * @param diff Git diff string
 * @returns Map of file paths to their diff information
 */
export function parseDiff(diff: string): DiffFileMap {
  const fileMap = new Map<string, DiffInfo>()

  // Split the diff into file sections
  const fileSections = diff.split('diff --git ')

  for (let i = 1; i < fileSections.length; i++) {
    const section = fileSections[i]

    // Extract file path
    const filePathMatch = section.match(/a\/(.+?) b\//)
    if (!filePathMatch) continue

    const filePath = filePathMatch[1]
    const changedLines = new Set<number>()

    // Extract hunks
    const hunks = section.split('\n@@').slice(1)

    for (const hunk of hunks) {
      // Extract hunk header
      const hunkHeaderMatch = hunk.match(/^[ -+](-\d+,\d+ \+\d+,\d+) @@/)
      if (!hunkHeaderMatch) continue

      // Split hunk into lines
      const lines = hunk.split('\n')
      let lineNumber = parseInt(
        hunkHeaderMatch[1].match(/\+(\d+)/)?.[1] || '0',
        10
      )

      // Process each line in the hunk
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j]

        // Skip removed lines (they don't exist in the new file)
        if (line.startsWith('-')) continue

        // For added lines, track the line number
        if (line.startsWith('+')) {
          // This is an added/modified line
          changedLines.add(lineNumber)
        }

        // Increment line number for context and added lines
        if (line.startsWith('+') || !line.startsWith('-')) {
          lineNumber++
        }
      }
    }

    fileMap.set(filePath, { changedLines })
  }

  return fileMap
}
