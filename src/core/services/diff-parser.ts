import type { DiffFileMap, DiffHunk, DiffInfo } from '../models/diff-types.ts'

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
    const hunks: DiffHunk[] = []

    // Extract hunks
    const hunkSections = section.split('\n@@').slice(1)

    for (const hunk of hunkSections) {
      // Extract hunk header
      const hunkHeaderMatch = hunk.match(/^[ -+](-\d+,\d+ \+\d+,\d+) @@(.*)/)
      if (!hunkHeaderMatch) continue

      const hunkHeader = `@@${hunkHeaderMatch[1]} @@${hunkHeaderMatch[2] || ''}`

      // Parse the hunk range for new file (+)
      const newRangeMatch = hunkHeaderMatch[1].match(/\+(\d+),?(\d+)?/)
      if (!newRangeMatch) continue

      const startLine = parseInt(newRangeMatch[1], 10)
      const lineCount = parseInt(newRangeMatch[2] || '1', 10)
      const endLine = startLine + lineCount - 1

      // Split hunk into lines
      const lines = hunk.split('\n')
      let currentLineNumber = startLine

      // Process each line in the hunk to track changed lines
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j]

        // Skip removed lines (they don't exist in the new file)
        if (line.startsWith('-')) continue

        // For added lines, track the line number
        if (line.startsWith('+')) {
          // This is an added/modified line
          changedLines.add(currentLineNumber)
        }

        // Increment line number for context and added lines
        if (line.startsWith('+') || !line.startsWith('-')) {
          currentLineNumber++
        }
      }

      // Store hunk information
      hunks.push({
        startLine,
        endLine,
        header: hunkHeader
      })
    }

    fileMap.set(filePath, { changedLines, hunks })
  }

  return fileMap
}
