import type { SearchReplaceBlock } from '../../comment-handlers/types.ts'

// Types for processing results
interface ProcessingResult {
  success: boolean
  errors: string[]
  appliedBlocks: number
  modifiedContent?: string
  originalStartLine?: number // First line affected in original content
  originalEndLine?: number // Last line affected in original content
}

interface MatchResult {
  found: boolean
  startLine: number
  endLine: number
  method: 'exact' | 'line-trimmed' | 'block-anchor'
}

/**
 * Processes SEARCH/REPLACE blocks using the multi-tier matching strategy
 * Based on the Cline file editing algorithm
 */
export function processSearchReplaceBlocks(
  originalContent: string,
  blocks: SearchReplaceBlock[]
): ProcessingResult {
  let workingLines = originalContent.split('\n')
  let lastProcessedLine = 0
  const errors: string[] = []
  let appliedBlocks = 0

  // Track the original line ranges that will be affected
  let originalStartLine: number | undefined
  let originalEndLine: number | undefined
  let lineOffset = 0 // Tracks how many lines have been added/removed

  for (const [blockIndex, block] of blocks.entries()) {
    try {
      // Convert working lines back to string for matching
      const workingContent = workingLines.join('\n')

      const matchResult = findMatchWithFallbacks(
        workingContent,
        block.search,
        lastProcessedLine
      )

      if (!matchResult.found) {
        const error = `SEARCH/REPLACE block ${blockIndex + 1} failed to match. Search content:\n${block.search}`
        errors.push(error)
        continue
      }

      // Ensure we're not going backwards (blocks should be in order)
      if (matchResult.startLine < lastProcessedLine) {
        const error = `SEARCH/REPLACE block ${blockIndex + 1} matched content before previously processed content. Blocks must be in file order.`
        errors.push(error)
        continue
      }

      // Map working content line numbers back to original content line numbers
      const originalMatchStartLine = matchResult.startLine - lineOffset
      const originalMatchEndLine = matchResult.endLine - lineOffset

      // Track the overall range in original content coordinates
      if (originalStartLine === undefined) {
        originalStartLine = originalMatchStartLine
      }
      originalEndLine = originalMatchEndLine

      // Apply the replacement using line-based operations
      const replacementLines = block.replace.split('\n')

      // Build new lines array: before + replacement + after
      const beforeLines = workingLines.slice(0, matchResult.startLine)
      const afterLines = workingLines.slice(matchResult.endLine + 1)

      workingLines = [...beforeLines, ...replacementLines, ...afterLines]

      // Update line offset for future blocks
      const originalLineCount = matchResult.endLine - matchResult.startLine + 1
      const replacementLineCount = replacementLines.length
      lineOffset += replacementLineCount - originalLineCount

      // Update the last processed line (accounting for lines added/removed by replacement)
      lastProcessedLine = matchResult.startLine + replacementLineCount
      appliedBlocks++
    } catch (error) {
      const errorMsg = `Error processing SEARCH/REPLACE block ${blockIndex + 1}: ${error instanceof Error ? error.message : String(error)}`
      errors.push(errorMsg)
    }
  }

  return {
    success: appliedBlocks > 0 && errors.length === 0,
    modifiedContent: appliedBlocks > 0 ? workingLines.join('\n') : undefined,
    errors,
    appliedBlocks,
    originalStartLine,
    originalEndLine
  }
}

/**
 * Attempts to find a match for the given `searchContent` within `originalContent`, starting from `startLine`,
 * using a series of fallback strategies. Returns detailed information about the match if found.
 *
 * The matching process proceeds in the following order:
 * 1. **Exact Match:** Searches for an exact line sequence match.
 * 2. **Line-Trimmed Fallback:** If no exact match is found, attempts a match after trimming whitespace from each line.
 * 3. **Block Anchor Fallback:** As a last resort, tries to match using block anchors (suitable for multi-line blocks).
 *
 * @param originalContent - The full text in which to search for a match.
 * @param searchContent - The substring or block of text to search for.
 * @param startLine - The line number in `originalContent` from which to start searching.
 * @returns An object describing the match result, including whether a match was found, the start and end line numbers,
 *          and the matching method used (`'exact'`, `'line-trimmed'`, or `'block-anchor'`).
 */
export function findMatchWithFallbacks(
  originalContent: string,
  searchContent: string,
  startLine: number
): MatchResult {
  // Tier 1: Exact line sequence match
  const exactResult = exactLineMatch(originalContent, searchContent, startLine)
  if (exactResult) {
    return {
      found: true,
      startLine: exactResult[0],
      endLine: exactResult[1],
      method: 'exact'
    }
  }

  // Tier 2: Line-trimmed fallback match
  const lineTrimmedResult = lineTrimmedFallbackMatch(
    originalContent,
    searchContent,
    startLine
  )
  if (lineTrimmedResult) {
    return {
      found: true,
      startLine: lineTrimmedResult[0],
      endLine: lineTrimmedResult[1],
      method: 'line-trimmed'
    }
  }

  // Tier 3: Block anchor fallback match (for 3+ line blocks)
  const blockAnchorResult = blockAnchorFallbackMatch(
    originalContent,
    searchContent,
    startLine
  )
  if (blockAnchorResult) {
    return {
      found: true,
      startLine: blockAnchorResult[0],
      endLine: blockAnchorResult[1],
      method: 'block-anchor'
    }
  }

  return {
    found: false,
    startLine: -1,
    endLine: -1,
    method: 'exact'
  }
}

/**
 * Splits the given search content into an array of lines.
 *
 * Removes the trailing line if it is empty or contains only whitespace.
 *
 * @param searchContent - The string content to be split into lines.
 * @returns An array of strings, each representing a line from the input, with any trailing empty line removed.
 */
function normalizeSearchLines(searchContent: string): string[] {
  const searchLines = searchContent.split('\n')
  // Only remove trailing empty line if it's truly empty (not just whitespace)
  if (
    searchLines.length > 0 &&
    searchLines[searchLines.length - 1].trim() === ''
  ) {
    searchLines.pop()
  }
  return searchLines
}

/**
 * Exact line sequence matching - matches exact line sequences
 */
function exactLineMatch(
  originalContent: string,
  searchContent: string,
  startLine: number
): [number, number] | false {
  const originalLines = originalContent.split('\n')
  const searchLines = normalizeSearchLines(searchContent)

  if (searchLines.length === 0) {
    return false
  }

  // For each possible starting position in original content
  for (let i = startLine; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    // Try to match all search lines exactly from this position
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j] !== searchLines[j]) {
        matches = false
        break
      }
    }

    // If we found a match, return line numbers
    if (matches) {
      return [i, i + searchLines.length - 1]
    }
  }

  return false
}

/**
 * Line-trimmed fallback matching - handles whitespace differences
 */
function lineTrimmedFallbackMatch(
  originalContent: string,
  searchContent: string,
  startLine: number
): [number, number] | false {
  const originalLines = originalContent.split('\n')
  const searchLines = normalizeSearchLines(searchContent)

  if (searchLines.length === 0) {
    return false
  }

  // For each possible starting position in original content
  for (let i = startLine; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    // Try to match all search lines from this position
    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j]?.trim() || ''
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    // If we found a match, return line numbers
    if (matches) {
      return [i, i + searchLines.length - 1]
    }
  }

  return false
}

/**
 * Attempts to find a block of text within the original content that matches the given search content,
 * using the first and last lines of the search block as anchors. Only operates on multi-line (3+ lines) blocks.
 * Returns the start and end line numbers of the match, or `false` if no match is found.
 *
 * @param originalContent - The full original text to search within.
 * @param searchContent - The multi-line block of text to search for.
 * @param startLine - The line number in the original content to start searching from.
 * @returns A tuple of [startLine, endLine] for the matched block, or `false` if not found.
 */
function blockAnchorFallbackMatch(
  originalContent: string,
  searchContent: string,
  startLine: number
): [number, number] | false {
  const originalLines = originalContent.split('\n')
  const searchLines = normalizeSearchLines(searchContent)
  // Only use this approach for blocks of 3+ lines
  if (searchLines.length < 3) {
    return false
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Look for matching start and end anchors
  for (let i = startLine; i <= originalLines.length - searchBlockSize; i++) {
    // Check if first line matches
    if (originalLines[i]?.trim() !== firstLineSearch) {
      continue
    }
    // Check if last line matches at the expected position
    if (originalLines[i + searchBlockSize - 1]?.trim() !== lastLineSearch) {
      continue
    }

    // Also verify middle lines have reasonable similarity
    // to prevent false matches with same start/end but different content
    let middleMatches = 0
    const requiredMatches = Math.ceil((searchBlockSize - 2) * 0.5)
    for (let j = 1; j < searchBlockSize - 1; j++) {
      const originalLine = originalLines[i + j]?.trim() || ''
      const searchLine = searchLines[j]?.trim() || ''
      if (originalLine === searchLine) {
        middleMatches++
        if (middleMatches >= requiredMatches) break // Early termination
      }
    }

    // Require at least 50% of middle lines to match
    const middleLineCount = searchBlockSize - 2
    if (middleLineCount > 0) {
      if (middleMatches / middleLineCount < 0.5) {
        continue
      }
    } // For 3-line blocks, only first/last line matching is required

    // Return line numbers
    return [i, i + searchBlockSize - 1]
  }

  return false
}

/**
 * Generates a GitHub suggestion block from replacement content
 * Simply formats the replacement content as a GitHub suggestion
 */
export function generateGitHubSuggestion(replacementContent: string): string {
  // Remove trailing newline if present to avoid double newlines in suggestion
  const content = replacementContent.endsWith('\n')
    ? replacementContent.slice(0, -1)
    : replacementContent

  return '```suggestion\n' + content + '\n```'
}
