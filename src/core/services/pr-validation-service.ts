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

export interface ValidationIssue {
  reason: string
  suggestion: string
}

export interface PRValidationResult {
  isValid: boolean
  issues: ValidationIssue[]
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
  maxFilesChanged: 25,
  maxDiffSize: 15000,
  maxIndividualFileSize: 3000,
  maxAdditionDeletionRatio: 10, // Skip PRs that are mostly additions without context
  minAdditionDeletionRatio: 0.1, // Skip PRs that are mostly deletions (cleanup PRs)
  skipDocumentationOnly: true,
  documentationExtensions: ['.md', '.txt', '.rst', '.adoc', '.tex']
}

interface DiffAnalysis {
  additions: number
  deletions: number
  largestFileSize: number
  additionDeletionRatio: number
}

interface FileAnalysis {
  documentationOnlyFiles: number
  codeFiles: number
  isDocumentationOnly: boolean
}

type ValidationResult = Pick<PRValidationResult, 'isValid' | 'issues'>

/**
 * Analyzes diff content to extract metrics about additions, deletions, and file sizes
 */
export function analyzeDiff(diff: string, diffLines: string[]): DiffAnalysis {
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

/**
 * Analyzes file paths to determine documentation vs code file distribution
 */
export function analyzeFiles(
  filePaths: string[],
  config: PRValidationConfig
): FileAnalysis {
  let documentationOnlyFiles = 0
  let codeFiles = 0

  for (const filePath of filePaths) {
    const fileName = filePath.toLowerCase()

    // Check for documentation files
    if (config.documentationExtensions.some((ext) => fileName.endsWith(ext))) {
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

/**
 * Runs validation checks against PR metrics and returns validation result with all issues
 */
export function runValidationChecks(
  metrics: PRValidationResult['metrics'],
  fileAnalysis: FileAnalysis,
  config: PRValidationConfig
): ValidationResult {
  const issues: ValidationIssue[] = []

  // Check: Too many files changed
  if (metrics.filesChanged > config.maxFilesChanged) {
    issues.push({
      reason: `This PR changes ${metrics.filesChanged} files, which exceeds the limit of ${config.maxFilesChanged} files.`,
      suggestion:
        'Consider breaking this PR into smaller, more focused changes. Large PRs are harder to review effectively and may contain unrelated changes.'
    })
  }

  // Check: Diff too large
  if (metrics.diffSize > config.maxDiffSize) {
    issues.push({
      reason: `This PR has ${metrics.diffSize} lines of diff, which exceeds the limit of ${config.maxDiffSize} lines.`,
      suggestion:
        'Consider splitting this PR into smaller chunks. Large diffs are difficult to review thoroughly and may hide important issues.'
    })
  }

  // Check: Individual file too large
  if (
    metrics.largestFileSize &&
    metrics.largestFileSize > config.maxIndividualFileSize
  ) {
    issues.push({
      reason: `This PR contains a file with ${metrics.largestFileSize} lines of changes, which exceeds the limit of ${config.maxIndividualFileSize} lines per file.`,
      suggestion:
        'Consider refactoring large changes into smaller, more focused modifications. Large file changes are harder to review and understand.'
    })
  }

  // Check: Mostly deletions (cleanup PR)
  if (
    metrics.additionDeletionRatio !== undefined &&
    metrics.additionDeletionRatio < config.minAdditionDeletionRatio
  ) {
    issues.push({
      reason:
        'This PR appears to be primarily a cleanup or deletion PR with very few additions.',
      suggestion:
        "Cleanup PRs with mostly deletions typically don't benefit from detailed code review. Consider having a human reviewer quickly verify the deletions are safe."
    })
  }

  // Check: Mostly additions without context
  if (
    metrics.additionDeletionRatio !== undefined &&
    metrics.additionDeletionRatio > config.maxAdditionDeletionRatio
  ) {
    issues.push({
      reason:
        'This PR appears to be mostly new code additions without sufficient context.',
      suggestion:
        'Large additions without context (like generated code or copy-pasted code) may not benefit from line-by-line review. Consider breaking into smaller PRs with more context.'
    })
  }

  // Check: Documentation-only PR
  if (config.skipDocumentationOnly && fileAnalysis.isDocumentationOnly) {
    issues.push({
      reason: 'This PR only changes documentation files.',
      suggestion:
        "Documentation-only PRs typically don't require detailed code review. Consider having a human reviewer check for clarity and accuracy instead."
    })
  }

  // If there are issues, return invalid with all issues in the issues array
  if (issues.length > 0) {
    return {
      isValid: false,
      issues
    }
  }

  return {
    isValid: true,
    issues: []
  }
}

/**
 * Formats validation issues as markdown for display in PR comments
 */
export function formatValidationIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return ''
  return `### Issues Found

${issues
  .map(
    (issue, index) => `**${index + 1}.** ${issue.reason}

*Suggestion:* ${issue.suggestion}`
  )
  .join('\n\n')}`
}

/**
 * Creates a new validation configuration by merging provided config with defaults
 */
export function createValidationConfig(
  partialConfig: Partial<PRValidationConfig> = {}
): PRValidationConfig {
  return { ...DEFAULT_VALIDATION_CONFIG, ...partialConfig }
}

/**
 * Validates whether a PR should be reviewed by the bot
 * Checks for various conditions that make PRs unsuitable for automated review
 */
export async function validatePR(
  client: PlatformClient,
  prNumber: number,
  config: PRValidationConfig = DEFAULT_VALIDATION_CONFIG,
  repoPath?: string
): Promise<PRValidationResult> {
  try {
    // Get PR diff
    const diff = await client.fetchPullRequestDiff(prNumber)

    // Extract all modified files
    const allFilesChanged = extractModifiedFilePaths(diff)

    // Filter out ignored files (binary, generated, etc.)
    const reviewableFiles = repoPath
      ? await filterIgnoredFiles(allFilesChanged, repoPath)
      : allFilesChanged

    const diffLines = diff.split('\n')
    const diffSize = diffLines.length

    // Analyze diff content
    const diffAnalysis = analyzeDiff(diff, diffLines)

    // Check file patterns on reviewable files only
    const fileAnalysis = analyzeFiles(reviewableFiles, config)

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
    const validationResult = runValidationChecks(metrics, fileAnalysis, config)

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
      issues: [],
      metrics: {
        filesChanged: 0,
        reviewableFilesChanged: 0,
        diffSize: 0,
        documentationOnlyFiles: 0
      }
    }
  }
}
