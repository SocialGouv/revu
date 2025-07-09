import {
  extractModifiedFilePaths,
  filterIgnoredFiles
} from '../../file-utils.ts'
import { logSystemError } from '../../utils/logger.ts'
import type { PlatformClient } from '../models/platform-types.ts'

export interface PRValidationConfig {
  maxFilesChanged: number
  maxDiffSize: number
  maxIndividualFileSize: number
  maxAdditionDeletionRatio: number
  minAdditionDeletionRatio: number
  skipDocumentationOnly: boolean
  documentationExtensions: string[]
}

export interface PRValidationResult {
  isValid: boolean
  reason?: string
  suggestion?: string
  metrics: {
    filesChanged: number
    reviewableFilesChanged: number
    diffSize: number
    largestFileSize?: number
    additionDeletionRatio?: number
    documentationOnlyFiles: number
  }
}

export const DEFAULT_VALIDATION_CONFIG: PRValidationConfig = {
  maxFilesChanged: 75,
  maxDiffSize: 15000,
  maxIndividualFileSize: 3000,
  maxAdditionDeletionRatio: 10, // Skip PRs that are mostly deletions (cleanup)
  minAdditionDeletionRatio: 0.1, // Skip PRs that are mostly additions without context
  skipDocumentationOnly: true,
  documentationExtensions: ['.md', '.txt', '.rst', '.adoc', '.tex']
}

/**
 * Validates whether a PR should be reviewed by the bot
 * Checks for various conditions that make PRs unsuitable for automated review
 */
export class PRValidationService {
  constructor(
    private client: PlatformClient,
    private config: PRValidationConfig = DEFAULT_VALIDATION_CONFIG
  ) {}

  /**
   * Validates a PR and returns whether it should be reviewed
   * Now works with filtered files (after removing binary/generated files)
   */
  async validatePR(
    prNumber: number,
    repoPath?: string
  ): Promise<PRValidationResult> {
    try {
      // Get PR diff
      const diff = await this.client.fetchPullRequestDiff(prNumber)

      // Extract all modified files
      const allFilesChanged = extractModifiedFilePaths(diff)

      // Filter out ignored files (binary, generated, etc.)
      const reviewableFiles = repoPath
        ? await filterIgnoredFiles(allFilesChanged, repoPath)
        : allFilesChanged

      const diffLines = diff.split('\n')
      const diffSize = diffLines.length

      // Analyze diff content
      const diffAnalysis = this.analyzeDiff(diff, diffLines)

      // Check file patterns on reviewable files only
      const fileAnalysis = this.analyzeFiles(reviewableFiles)

      // Calculate metrics
      const metrics = {
        filesChanged: allFilesChanged.length,
        reviewableFilesChanged: reviewableFiles.length,
        diffSize,
        largestFileSize: diffAnalysis.largestFileSize,
        additionDeletionRatio: diffAnalysis.additionDeletionRatio,
        documentationOnlyFiles: fileAnalysis.documentationOnlyFiles
      }

      // Run validation checks on reviewable files
      const validationResult = this.runValidationChecks(
        metrics,
        reviewableFiles,
        fileAnalysis
      )

      return {
        ...validationResult,
        metrics
      }
    } catch (error) {
      logSystemError(`PR validation failed: ${error.message}`, {
        pr_number: prNumber
      })

      // On validation error, allow review to proceed (fail open)
      return {
        isValid: true,
        metrics: {
          filesChanged: 0,
          reviewableFilesChanged: 0,
          diffSize: 0,
          documentationOnlyFiles: 0
        }
      }
    }
  }

  private analyzeDiff(diff: string, diffLines: string[]) {
    let additions = 0
    let deletions = 0
    let largestFileSize = 0
    let currentFileSize = 0

    for (const line of diffLines) {
      if (line.startsWith('diff --git')) {
        // New file, reset counter
        if (currentFileSize > largestFileSize) {
          largestFileSize = currentFileSize
        }
        currentFileSize = 0
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
        currentFileSize++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
        currentFileSize++
      } else if (!line.startsWith('@@') && !line.startsWith('index ')) {
        currentFileSize++
      }
    }

    // Check final file
    if (currentFileSize > largestFileSize) {
      largestFileSize = currentFileSize
    }

    const additionDeletionRatio =
      deletions > 0 ? additions / deletions : additions > 0 ? Infinity : 1

    return {
      additions,
      deletions,
      largestFileSize,
      additionDeletionRatio
    }
  }

  private analyzeFiles(filePaths: string[]) {
    let documentationOnlyFiles = 0
    let codeFiles = 0

    for (const filePath of filePaths) {
      const fileName = filePath.toLowerCase()

      // Check for documentation files
      if (
        this.config.documentationExtensions.some((ext) =>
          fileName.endsWith(ext)
        )
      ) {
        documentationOnlyFiles++
        continue
      }

      codeFiles++
    }

    return {
      documentationOnlyFiles,
      codeFiles,
      isDocumentationOnly: codeFiles === 0 && documentationOnlyFiles > 0
    }
  }

  private runValidationChecks(
    metrics: PRValidationResult['metrics'],
    filePaths: string[],
    fileAnalysis: ReturnType<typeof PRValidationService.prototype.analyzeFiles>
  ): Pick<PRValidationResult, 'isValid' | 'reason' | 'suggestion'> {
    // Check: Too many files changed
    if (metrics.filesChanged > this.config.maxFilesChanged) {
      return {
        isValid: false,
        reason: `This PR changes ${metrics.filesChanged} files, which exceeds the limit of ${this.config.maxFilesChanged} files.`,
        suggestion:
          'Consider breaking this PR into smaller, more focused changes. Large PRs are harder to review effectively and may contain unrelated changes.'
      }
    }

    // Check: Diff too large
    if (metrics.diffSize > this.config.maxDiffSize) {
      return {
        isValid: false,
        reason: `This PR has ${metrics.diffSize} lines of diff, which exceeds the limit of ${this.config.maxDiffSize} lines.`,
        suggestion:
          'Consider splitting this PR into smaller chunks. Large diffs are difficult to review thoroughly and may hide important issues.'
      }
    }

    // Check: Individual file too large
    if (
      metrics.largestFileSize &&
      metrics.largestFileSize > this.config.maxIndividualFileSize
    ) {
      return {
        isValid: false,
        reason: `This PR contains a file with ${metrics.largestFileSize} lines of changes, which exceeds the limit of ${this.config.maxIndividualFileSize} lines per file.`,
        suggestion:
          'Consider refactoring large changes into smaller, more focused modifications. Large file changes are harder to review and understand.'
      }
    }

    // Check: Mostly deletions (cleanup PR)
    if (
      metrics.additionDeletionRatio !== undefined &&
      metrics.additionDeletionRatio < this.config.minAdditionDeletionRatio
    ) {
      return {
        isValid: false,
        reason:
          'This PR appears to be primarily a cleanup or deletion PR with very few additions.',
        suggestion:
          "Cleanup PRs with mostly deletions typically don't benefit from detailed code review. Consider having a human reviewer quickly verify the deletions are safe."
      }
    }

    // Check: Mostly additions without context
    if (
      metrics.additionDeletionRatio !== undefined &&
      metrics.additionDeletionRatio > this.config.maxAdditionDeletionRatio
    ) {
      return {
        isValid: false,
        reason:
          'This PR appears to be mostly new code additions without sufficient context.',
        suggestion:
          'Large additions without context (like generated code or copy-pasted code) may not benefit from line-by-line review. Consider breaking into smaller PRs with more context.'
      }
    }

    // Check: Documentation-only PR
    if (this.config.skipDocumentationOnly && fileAnalysis.isDocumentationOnly) {
      return {
        isValid: false,
        reason: 'This PR only changes documentation files.',
        suggestion:
          "Documentation-only PRs typically don't require detailed code review. Consider having a human reviewer check for clarity and accuracy instead."
      }
    }

    return { isValid: true }
  }

  /**
   * Updates the validation configuration
   */
  updateConfig(newConfig: Partial<PRValidationConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  /**
   * Gets the current validation configuration
   */
  getConfig(): PRValidationConfig {
    return { ...this.config }
  }
}
