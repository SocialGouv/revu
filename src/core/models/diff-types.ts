/**
 * Information about a diff hunk
 */
export interface DiffHunk {
  startLine: number // First line number in the hunk (1-based)
  endLine: number // Last line number in the hunk (1-based)
  header: string // The @@ header line
}

/**
 * Information about changed lines in a file diff
 */
export interface DiffInfo {
  changedLines: Set<number> // Set of line numbers that were changed in the diff
  hunks: DiffHunk[] // Array of hunks in the diff
}

/**
 * Map of file paths to their diff information
 */
export type DiffFileMap = Map<string, DiffInfo>
