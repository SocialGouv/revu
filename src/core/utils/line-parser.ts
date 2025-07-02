/**
 * Utility functions for parsing line numbers from marker IDs
 */

interface ParsedLineInfo {
  isRange: boolean
  startLine: number
  endLine?: number
}

type LineParseResult =
  | {
      success: true
      lineInfo: ParsedLineInfo
    }
  | {
      success: false
      reason: 'invalid_format' | 'invalid_numbers' | 'invalid_range'
    }

/**
 * Parses line string from marker ID (e.g., "123" or "123-125")
 */
export function parseLineString(lineStr: string): LineParseResult {
  if (!lineStr) {
    return { success: false, reason: 'invalid_format' }
  }

  const isRange = lineStr.includes('-')

  if (isRange) {
    const [startStr, endStr] = lineStr.split('-')
    const startLine = parseInt(startStr, 10)
    const endLine = parseInt(endStr, 10)

    if (isNaN(startLine) || isNaN(endLine)) {
      return { success: false, reason: 'invalid_numbers' }
    }

    if (startLine > endLine) {
      return { success: false, reason: 'invalid_range' }
    }

    return {
      success: true,
      lineInfo: { isRange: true, startLine, endLine }
    }
  } else {
    const line = parseInt(lineStr, 10)
    if (isNaN(line)) {
      return { success: false, reason: 'invalid_numbers' }
    }

    return {
      success: true,
      lineInfo: { isRange: false, startLine: line }
    }
  }
}

/**
 * Checks if parsed line info is still relevant in the current diff
 */
export function isLineInfoInDiff(
  lineInfo: ParsedLineInfo,
  fileInfo: { changedLines: Set<number> } | undefined
): boolean {
  if (!fileInfo) {
    return false
  }

  if (lineInfo.isRange && lineInfo.endLine !== undefined) {
    // Check if all lines in the range are still in the diff
    for (let line = lineInfo.startLine; line <= lineInfo.endLine; line++) {
      if (!fileInfo.changedLines.has(line)) {
        return false
      }
    }
    return true
  } else {
    // Single line check
    return fileInfo.changedLines.has(lineInfo.startLine)
  }
}
