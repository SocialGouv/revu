/**
 * Information about changed lines in a file diff
 */
export interface DiffInfo {
  changedLines: Set<number> // Set of line numbers that were changed in the diff
}

/**
 * Map of file paths to their diff information
 */
export type DiffFileMap = Map<string, DiffInfo>
