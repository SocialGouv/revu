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
    largeFiles?: Array<{ fileName: string; size: number }>
  }
}

export const DEFAULT_VALIDATION_CONFIG: PRValidationConfig = {
  maxFilesChanged: 25,
  maxDiffSize: 15000,
  maxIndividualFileSize: 3000,
  skipDocumentationOnly: true,
  documentationExtensions: ['.md', '.txt', '.rst', '.adoc', '.tex']
}

interface DiffAnalysis {
  additions: number
  deletions: number
  additionDeletionRatio: number
  largeFiles: Array<{ fileName: string; size: number }>
  largestFileSize?: number
}

interface FileAnalysis {
  documentationOnlyFiles: number
  codeFiles: number
  isDocumentationOnly: boolean
}

type ValidationResult = Pick<PRValidationResult, 'isValid' | 'issues'>

/**
 * Analyzes diff content to extract metrics about additions, deletions, and file sizes
 * Only processes files that are in the reviewableFiles list, skipping ignored files completely
 */
export function analyzeDiff(
  diffLines: string[],
  reviewableFiles: string[],
  maxIndividualFileSize?: number
): DiffAnalysis {
  let additions = 0
  let deletions = 0
  let currentFileName = ''
  const largeFiles: Array<{ fileName: string; size: number }> = []
  let largestFileSize = 0

  interface Sizes {
    changeSize: number
    additions: number
    deletions: number
  }

  // Use Set for O(1) lookup performance
  const reviewableFilesSet = new Set(reviewableFiles)
  const fileChangeSizes = new Map<string, Sizes>()

  let fileSizes: Sizes = {
    changeSize: 0,
    additions: 0,
    deletions: 0
  }

  for (const line of diffLines) {
    if (line.startsWith('diff --git')) {
      // Save previous file sizes if it is a reviewable file
      if (
        currentFileName &&
        reviewableFilesSet.has(currentFileName) &&
        fileSizes.changeSize > 0
      ) {
        fileChangeSizes.set(currentFileName, fileSizes)
      }

      // Extract file name from diff header
      const match = line.match(/^diff --git a\/(.*?) b\/(.*)$/)
      currentFileName = match ? match[2] : ''
      fileSizes = {
        changeSize: 0,
        additions: 0,
        deletions: 0
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      fileSizes.additions++
      fileSizes.changeSize++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      fileSizes.deletions++
      fileSizes.changeSize++
    } else if (!line.startsWith('@@') && !line.startsWith('index ')) {
      // This ignores hunks ('@@') and index lines
      fileSizes.changeSize++
    }
  }

  // Handle the last file
  if (
    currentFileName &&
    reviewableFilesSet.has(currentFileName) &&
    fileSizes.changeSize > 0
  ) {
    fileChangeSizes.set(currentFileName, fileSizes)
  }

  // Process all files in fileSizes map
  for (const [fileName, sizes] of fileChangeSizes.entries()) {
    additions += sizes.additions
    deletions += sizes.deletions

    // Track largest file size
    if (sizes.changeSize > largestFileSize) {
      largestFileSize = sizes.changeSize
    }

    // Add to large files if it exceeds the limit
    if (maxIndividualFileSize && sizes.changeSize > maxIndividualFileSize) {
      largeFiles.push({ fileName, size: sizes.changeSize })
    }
  }

  const additionDeletionRatio =
    deletions > 0 ? additions / deletions : additions > 0 ? Infinity : 1

  return {
    additions,
    deletions,
    additionDeletionRatio,
    largeFiles,
    largestFileSize: largestFileSize > 0 ? largestFileSize : undefined
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
  if (metrics.largeFiles && metrics.largeFiles.length > 0) {
    const fileList = metrics.largeFiles
      .map((file) => `'${file.fileName}' (${file.size} lines of changes)`)
      .join(', ')
    issues.push({
      reason: `This PR contains files that exceed the size limit: ${fileList}, which exceeds the limit of ${config.maxIndividualFileSize}. The limit is ${config.maxIndividualFileSize} lines per file.`,
      suggestion:
        'Consider refactoring large changes into smaller, more focused modifications. Large file changes are harder to review and understand.'
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
  config: PRValidationConfig = DEFAULT_VALIDATION_CONFIG
): Promise<PRValidationResult> {
  try {
    // Get PR details to get the commit SHA
    const pr = await client.getPullRequest(prNumber)
    const commitSha = pr.head.sha

    // Get PR diff
    const diff = await client.fetchPullRequestDiff(prNumber)

    // Extract all modified files
    const allFilesChanged = extractModifiedFilePaths(diff)

    // Filter out ignored files (binary, generated, etc.) using .revuignore
    // Always use remote fetching now
    const reviewableFiles = await filterIgnoredFiles(
      allFilesChanged,
      client,
      commitSha
    )
    const diffLines = diff.split('\n')
    const diffSize = diffLines.length

    // Analyze diff content
    const diffAnalysis = analyzeDiff(
      diffLines,
      reviewableFiles,
      config.maxIndividualFileSize
    )

    // Check file patterns on reviewable files only
    const fileAnalysis = analyzeFiles(reviewableFiles, config)

    // Calculate metrics
    const metrics = {
      filesChanged: allFilesChanged.length,
      reviewableFilesChanged: reviewableFiles.length,
      diffSize,
      largestFileSize: diffAnalysis.largestFileSize,
      additionDeletionRatio: diffAnalysis.additionDeletionRatio,
      documentationOnlyFiles: fileAnalysis.documentationOnlyFiles,
      largeFiles: diffAnalysis.largeFiles
    }

    // Run validation checks on reviewable files
    const validationResult = runValidationChecks(metrics, fileAnalysis, config)

    return {
      ...validationResult,
      metrics
    }
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      context_msg: 'Failed to validate PR'
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
