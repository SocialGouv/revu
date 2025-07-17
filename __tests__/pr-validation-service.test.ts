import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformClient } from '../src/core/models/platform-types.ts'
import {
  analyzeDiff,
  analyzeFiles,
  createValidationConfig,
  DEFAULT_VALIDATION_CONFIG,
  formatValidationIssues,
  runValidationChecks,
  validatePR
} from '../src/core/services/pr-validation-service.ts'

// Mock platform client
const createMockClient = (diff: string): PlatformClient => ({
  fetchPullRequestDiff: vi.fn().mockResolvedValue(diff),
  fetchIssueDetails: vi.fn(),
  cloneRepository: vi.fn(),
  createReview: vi.fn(),
  createReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
  getPullRequest: vi.fn().mockResolvedValue({
    head: { sha: 'mock-commit-sha-123' },
    number: 123,
    state: 'open',
    mergeable: true,
    title: 'Mock PR Title',
    body: 'Mock PR Body'
  }),
  listReviewComments: vi.fn(),
  getReviewComment: vi.fn(),
  deleteReviewComment: vi.fn(),
  fetchPullRequestDiffMap: vi.fn(),
  getFileContent: vi
    .fn()
    .mockResolvedValue('# Mock .revuignore content\n*.log\n*.tmp\n'),
  listReviews: vi.fn()
})

describe('PR Validation Service', () => {
  let mockClient: PlatformClient

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validatePR', () => {
    describe('File Count Validation', () => {
      it('should reject PRs with too many files changed', async () => {
        const diff = Array.from(
          { length: 100 },
          (_, i) =>
            `diff --git a/file${i}.ts b/file${i}.ts\nindex 123..456 100644\n--- a/file${i}.ts\n+++ b/file${i}.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line`
        ).join('\n')

        mockClient = createMockClient(diff)
        const config = createValidationConfig({ maxFilesChanged: 50 })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(false)
        expect(result.issues).toHaveLength(1)
        expect(result.issues[0].reason).toContain('100 files')
        expect(result.issues[0].reason).toContain('exceeds the limit of 50')
        expect(result.issues[0].suggestion).toContain(
          'breaking this PR into smaller'
        )
        expect(result.metrics.filesChanged).toBe(100)
      })

      it('should accept PRs with acceptable file count', async () => {
        const diff = Array.from(
          { length: 10 },
          (_, i) =>
            `diff --git a/file${i}.ts b/file${i}.ts\nindex 123..456 100644\n--- a/file${i}.ts\n+++ b/file${i}.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line`
        ).join('\n')

        mockClient = createMockClient(diff)

        const result = await validatePR(mockClient, 123)

        expect(result.isValid).toBe(true)
        expect(result.metrics.filesChanged).toBe(10)
      })
    })

    describe('Diff Size Validation', () => {
      it('should reject PRs with very large diffs', async () => {
        const largeDiff = Array.from(
          { length: 20000 },
          (_, i) => `+line ${i}`
        ).join('\n')

        mockClient = createMockClient(largeDiff)
        const config = createValidationConfig({ maxDiffSize: 10000 })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(false)
        expect(result.issues.length).toBeGreaterThan(0)
        // Find the diff size issue
        const diffSizeIssue = result.issues.find((issue) =>
          issue.reason.includes('20000 lines of diff')
        )
        expect(diffSizeIssue).toBeDefined()
        expect(diffSizeIssue.reason).toContain('exceeds the limit of 10000')
      })

      it('should accept PRs with reasonable diff size', async () => {
        const smallDiff = `diff --git a/small-file.ts b/small-file.ts
index 123..456 100644
--- a/small-file.ts
+++ b/small-file.ts
@@ -1,5 +1,10 @@
 function test() {
-  console.log('old')
+  console.log('new')
+  console.log('line 1')
+  console.log('line 2')
+  console.log('line 3')
+  console.log('line 4')
 }`

        mockClient = createMockClient(smallDiff)

        const result = await validatePR(mockClient, 123)

        expect(result.isValid).toBe(true)
        expect(result.metrics.diffSize).toBeLessThan(
          DEFAULT_VALIDATION_CONFIG.maxDiffSize
        )
      })
    })

    describe('Individual File Size Validation', () => {
      it('should reject PRs with very large individual file changes', async () => {
        const largeFileDiff = `diff --git a/large-file.ts b/large-file.ts
index 123..456 100644
--- a/large-file.ts
+++ b/large-file.ts
@@ -1,1000 +1,5000 @@
${Array.from({ length: 4000 }, (_, i) => `+line ${i}`).join('\n')}`

        mockClient = createMockClient(largeFileDiff)
        const config = createValidationConfig({
          maxIndividualFileSize: 2000,
          maxDiffSize: 50000 // Set high to avoid diff size validation
        })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(false)
        expect(result.issues.length).toBeGreaterThan(0)
        // Find the individual file size issue
        const fileSizeIssue = result.issues.find((issue) =>
          issue.reason.includes('4002 lines of changes')
        )
        expect(fileSizeIssue).toBeDefined()
        expect(fileSizeIssue.reason).toContain('exceeds the limit of 2000')
      })
    })

    describe('Addition/Deletion Ratio Validation', () => {
      it('should reject cleanup PRs with mostly deletions', async () => {
        const cleanupDiff = `diff --git a/old-file.ts b/old-file.ts
index 123..456 100644
--- a/old-file.ts
+++ b/old-file.ts
@@ -1,100 +1,5 @@
${Array.from({ length: 95 }, () => '-deleted line').join('\n')}
+new line 1
+new line 2
+new line 3
+new line 4
+new line 5`

        mockClient = createMockClient(cleanupDiff)
        const config = createValidationConfig({ minAdditionDeletionRatio: 0.1 })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(false)
        expect(result.issues).toHaveLength(1)
        expect(result.issues[0].reason).toContain('cleanup or deletion PR')
      })

      it('should reject PRs with too many additions without context', async () => {
        const massAdditionDiff = `diff --git a/new-file.ts b/new-file.ts
index 123..456 100644
--- a/new-file.ts
+++ b/new-file.ts
@@ -1,1 +1,1000 @@
-old line
${Array.from({ length: 999 }, (_, i) => `+new line ${i}`).join('\n')}`

        mockClient = createMockClient(massAdditionDiff)
        const config = createValidationConfig({ maxAdditionDeletionRatio: 10 })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(false)
        expect(result.issues).toHaveLength(1)
        expect(result.issues[0].reason).toContain(
          'mostly new code additions without sufficient context'
        )
      })
    })

    describe('Documentation-Only PRs', () => {
      it('should reject documentation-only PRs when configured', async () => {
        const docDiff = `diff --git a/README.md b/README.md
index 123..456 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-old docs
+new docs
diff --git a/docs/guide.md b/docs/guide.md
index 123..456 100644
--- a/docs/guide.md
+++ b/docs/guide.md
@@ -1,1 +1,1 @@
-old guide
+new guide`

        mockClient = createMockClient(docDiff)
        const config = createValidationConfig({ skipDocumentationOnly: true })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(false)
        expect(result.issues).toHaveLength(1)
        expect(result.issues[0].reason).toContain(
          'only changes documentation files'
        )
        expect(result.metrics.documentationOnlyFiles).toBe(2)
      })

      it('should accept documentation-only PRs when configured to allow them', async () => {
        const docDiff = `diff --git a/README.md b/README.md
index 123..456 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-old docs
+new docs`

        mockClient = createMockClient(docDiff)
        const config = createValidationConfig({ skipDocumentationOnly: false })

        const result = await validatePR(mockClient, 123, config)

        expect(result.isValid).toBe(true)
      })
    })

    describe('Error Handling', () => {
      it('should fail open when validation encounters errors', async () => {
        mockClient = createMockClient('')
        mockClient.fetchPullRequestDiff = vi
          .fn()
          .mockRejectedValue(new Error('API Error'))

        const result = await validatePR(mockClient, 123)

        expect(result.isValid).toBe(true) // Fail open
        expect(result.metrics.filesChanged).toBe(0)
      })
    })

    describe('File Filtering Integration', () => {
      it('should accept PRs with binary/generated files since they are now filtered during review', async () => {
        // This test verifies that binary and generated files no longer cause PR rejection
        // since they are now filtered out during the review process via .revuignore
        const mixedDiff = `diff --git a/src/main.ts b/src/main.ts
index 123..456 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,1 +1,1 @@
-old code
+new code
diff --git a/package-lock.json b/package-lock.json
index 123..456 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-old content
+new content
diff --git a/image.png b/image.png
index 123..456 100644
Binary files a/image.png and b/image.png differ`

        mockClient = createMockClient(mixedDiff)

        const result = await validatePR(mockClient, 123)

        // Should be valid since binary/generated files are now filtered during review
        expect(result.isValid).toBe(true)
        expect(result.metrics.filesChanged).toBe(3) // Total files in diff
        expect(result.metrics.reviewableFilesChanged).toBe(3) // Without filtering (no repoPath provided)
      })

      it('should track both total and reviewable file counts', async () => {
        const codeDiff = `diff --git a/src/main.ts b/src/main.ts
index 123..456 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,1 +1,1 @@
-old code
+new code
diff --git a/src/utils.ts b/src/utils.ts
index 123..456 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,1 +1,1 @@
-old code
+new code`

        mockClient = createMockClient(codeDiff)

        const result = await validatePR(mockClient, 123)

        expect(result.isValid).toBe(true)
        expect(result.metrics.filesChanged).toBe(2)
        expect(result.metrics.reviewableFilesChanged).toBe(2)
        expect(result.metrics.documentationOnlyFiles).toBe(0)
      })
    })

    describe('Metrics Calculation', () => {
      it('should correctly calculate metrics with new structure', async () => {
        const complexDiff = `diff --git a/src/main.ts b/src/main.ts
index 123..456 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,10 +1,15 @@
 function main() {
-  console.log('old')
+  console.log('new')
+  console.log('additional line 1')
+  console.log('additional line 2')
+  console.log('additional line 3')
 }
diff --git a/README.md b/README.md
index 123..456 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +1,1 @@
-old docs
+new docs
diff --git a/src/utils.ts b/src/utils.ts
index 123..456 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,1 +1,1 @@
-old code
+new code`

        mockClient = createMockClient(complexDiff)

        const result = await validatePR(mockClient, 123)

        expect(result.metrics.filesChanged).toBe(3)
        expect(result.metrics.reviewableFilesChanged).toBe(3)
        expect(result.metrics.documentationOnlyFiles).toBe(1) // README.md
        expect(result.metrics.additionDeletionRatio).toBeGreaterThan(1) // More additions than deletions
      })
    })
  })

  describe('analyzeDiff', () => {
    it('should correctly analyze diff content', () => {
      const diff = `diff --git a/file1.ts b/file1.ts
index 123..456 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,5 +1,8 @@
 function test() {
-  console.log('old')
+  console.log('new')
+  console.log('line 1')
+  console.log('line 2')
 }
diff --git a/file2.ts b/file2.ts
index 123..456 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,1 @@
-old line 1
-old line 2
+new line`

      const diffLines = diff.split('\n')
      const reviewableFiles = ['file1.ts', 'file2.ts'] // Both files are reviewable
      const result = analyzeDiff(diffLines, reviewableFiles)

      expect(result.additions).toBe(4) // 3 additions in file1 + 1 in file2
      expect(result.deletions).toBe(3) // 1 deletion in file1 + 2 in file2
      expect(result.additionDeletionRatio).toBeCloseTo(4 / 3)
      expect(result.largestFileSize).toBeGreaterThan(0)
    })

    it('should handle edge cases in diff analysis', () => {
      const diff = `diff --git a/empty.ts b/empty.ts
index 123..456 100644
--- a/empty.ts
+++ b/empty.ts
@@ -0,0 +1,1 @@
+new file content`

      const diffLines = diff.split('\n')
      const reviewableFiles = ['empty.ts'] // File is reviewable
      const result = analyzeDiff(diffLines, reviewableFiles)

      expect(result.additions).toBe(1)
      expect(result.deletions).toBe(0)
      expect(result.additionDeletionRatio).toBe(Infinity)
    })

    it('should identify large files when maxIndividualFileSize is provided', () => {
      const diff = `diff --git a/small-file.ts b/small-file.ts
index 123..456 100644
--- a/small-file.ts
+++ b/small-file.ts
@@ -1,1 +1,3 @@
-old line
+new line 1
+new line 2
+new line 3
diff --git a/large-file.ts b/large-file.ts
index 123..456 100644
--- a/large-file.ts
+++ b/large-file.ts
@@ -1,1 +1,6 @@
-old content
+new line 1
+new line 2
+new line 3
+new line 4
+new line 5
+new line 6`

      const diffLines = diff.split('\n')
      const reviewableFiles = ['small-file.ts', 'large-file.ts'] // Both files are reviewable
      const result = analyzeDiff(diffLines, reviewableFiles, 4) // Set limit to 4 lines

      // Both files should be identified as large since they both exceed 4 lines
      expect(result.largeFiles).toHaveLength(2)
      expect(result.largeFiles[0].fileName).toBe('small-file.ts')
      expect(result.largeFiles[0].size).toBe(6) // 1 deletion + 3 additions + 2 context lines
      expect(result.largeFiles[1].fileName).toBe('large-file.ts')
      expect(result.largeFiles[1].size).toBe(9) // 1 deletion + 6 additions + 2 context lines
    })

    it('should not identify large files when maxIndividualFileSize is not provided', () => {
      const diff = `diff --git a/large-file.ts b/large-file.ts
index 123..456 100644
--- a/large-file.ts
+++ b/large-file.ts
@@ -1,1 +1,10 @@
-old content
+new line 1
+new line 2
+new line 3
+new line 4
+new line 5
+new line 6
+new line 7
+new line 8
+new line 9
+new line 10`

      const diffLines = diff.split('\n')
      const reviewableFiles = ['large-file.ts'] // File is reviewable
      const result = analyzeDiff(diffLines, reviewableFiles) // No limit provided

      expect(result.largeFiles).toHaveLength(0)
      expect(result.largestFileSize).toBe(13) // 1 deletion + 10 additions + 2 context lines
    })

    it('should skip ignored files and only analyze reviewable files', () => {
      const diff = `diff --git a/src/main.ts b/src/main.ts
index 123..456 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,1 +1,3 @@
-old code
+new code line 1
+new code line 2
+new code line 3
diff --git a/package-lock.json b/package-lock.json
index 123..456 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,100 @@
-old content
${Array.from({ length: 99 }, (_, i) => `+generated line ${i}`).join('\n')}
diff --git a/binary-file.png b/binary-file.png
index 123..456 100644
Binary files a/binary-file.png and b/binary-file.png differ`

      const diffLines = diff.split('\n')
      // Only src/main.ts is reviewable, package-lock.json and binary-file.png are ignored
      const reviewableFiles = ['src/main.ts']
      const result = analyzeDiff(diffLines, reviewableFiles)

      // Should only count changes from src/main.ts (3 additions, 1 deletion)
      expect(result.additions).toBe(3)
      expect(result.deletions).toBe(1)
      expect(result.largestFileSize).toBe(6) // 1 deletion + 3 additions + 2 context lines from main.ts only
      expect(result.additionDeletionRatio).toBe(3) // 3 additions / 1 deletion
    })
  })

  describe('analyzeFiles', () => {
    it('should correctly identify documentation files', () => {
      const filePaths = [
        'src/main.ts',
        'README.md',
        'docs/guide.txt',
        'src/utils.js',
        'CHANGELOG.rst'
      ]

      const result = analyzeFiles(filePaths, DEFAULT_VALIDATION_CONFIG)

      expect(result.documentationOnlyFiles).toBe(3) // README.md, guide.txt, CHANGELOG.rst
      expect(result.codeFiles).toBe(2) // main.ts, utils.js
      expect(result.isDocumentationOnly).toBe(false)
    })

    it('should detect documentation-only changes', () => {
      const filePaths = ['README.md', 'docs/api.md']

      const result = analyzeFiles(filePaths, DEFAULT_VALIDATION_CONFIG)

      expect(result.documentationOnlyFiles).toBe(2)
      expect(result.codeFiles).toBe(0)
      expect(result.isDocumentationOnly).toBe(true)
    })
  })

  describe('runValidationChecks', () => {
    const mockMetrics = {
      filesChanged: 10,
      reviewableFilesChanged: 8,
      diffSize: 500,
      largestFileSize: 100,
      additionDeletionRatio: 2.0,
      documentationOnlyFiles: 1
    }

    const mockFileAnalysis = {
      documentationOnlyFiles: 1,
      codeFiles: 7,
      isDocumentationOnly: false
    }

    it('should pass validation for normal PRs', () => {
      const result = runValidationChecks(
        mockMetrics,
        mockFileAnalysis,
        DEFAULT_VALIDATION_CONFIG
      )

      expect(result.isValid).toBe(true)
      expect(result.issues).toHaveLength(0)
    })

    it('should fail validation for too many files', () => {
      const largeMetrics = { ...mockMetrics, filesChanged: 100 }

      const result = runValidationChecks(
        largeMetrics,
        mockFileAnalysis,
        DEFAULT_VALIDATION_CONFIG
      )

      expect(result.isValid).toBe(false)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].reason).toContain('100 files')
    })

    it('should collect multiple validation issues', () => {
      const multipleIssuesMetrics = {
        filesChanged: 100, // Too many files
        reviewableFilesChanged: 100,
        diffSize: 20000, // Too large diff
        largestFileSize: 5000, // Individual file too large
        additionDeletionRatio: 2.0,
        documentationOnlyFiles: 0,
        largeFiles: [{ fileName: 'src/large-component.tsx', size: 5000 }]
      }

      const result = runValidationChecks(
        multipleIssuesMetrics,
        mockFileAnalysis,
        {
          ...DEFAULT_VALIDATION_CONFIG,
          maxFilesChanged: 50,
          maxDiffSize: 10000,
          maxIndividualFileSize: 3000
        }
      )

      expect(result.isValid).toBe(false)
      expect(result.issues).toHaveLength(3)

      // Check that all three issues are present
      expect(result.issues[0].reason).toContain('100 files')
      expect(result.issues[1].reason).toContain('20000 lines of diff')
      expect(result.issues[2].reason).toContain('src/large-component.tsx')
      expect(result.issues[2].reason).toContain('5000 lines of changes')
    })

    it('should include file names for single large file', () => {
      const metricsWithLargeFile = {
        ...mockMetrics,
        largeFiles: [
          { fileName: 'src/components/LargeComponent.tsx', size: 4500 }
        ]
      }

      const result = runValidationChecks(
        metricsWithLargeFile,
        mockFileAnalysis,
        DEFAULT_VALIDATION_CONFIG
      )

      expect(result.isValid).toBe(false)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].reason).toContain(
        'src/components/LargeComponent.tsx'
      )
      expect(result.issues[0].reason).toContain('4500 lines of changes')
      expect(result.issues[0].reason).toContain('exceeds the limit of 3000')
    })

    it('should include file names for multiple large files', () => {
      const metricsWithMultipleLargeFiles = {
        ...mockMetrics,
        largeFiles: [
          { fileName: 'src/components/Component1.tsx', size: 4500 },
          { fileName: 'src/utils/helpers.ts', size: 3500 }
        ]
      }

      const result = runValidationChecks(
        metricsWithMultipleLargeFiles,
        mockFileAnalysis,
        DEFAULT_VALIDATION_CONFIG
      )

      expect(result.isValid).toBe(false)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0].reason).toContain('src/components/Component1.tsx')
      expect(result.issues[0].reason).toContain('4500 lines')
      expect(result.issues[0].reason).toContain('src/utils/helpers.ts')
      expect(result.issues[0].reason).toContain('3500 lines')
      expect(result.issues[0].reason).toContain(
        'The limit is 3000 lines per file'
      )
    })
  })

  describe('formatValidationIssues', () => {
    it('should return empty string for no issues', () => {
      const result = formatValidationIssues([])
      expect(result).toBe('')
    })

    it('should format single issue correctly', () => {
      const issues = [
        {
          reason: 'This PR changes too many files.',
          suggestion: 'Consider breaking this PR into smaller changes.'
        }
      ]

      const result = formatValidationIssues(issues)

      expect(result).toBe(`### Issues Found

**1.** This PR changes too many files.

*Suggestion:* Consider breaking this PR into smaller changes.`)
    })

    it('should format multiple issues correctly', () => {
      const issues = [
        {
          reason: 'This PR changes too many files.',
          suggestion: 'Consider breaking this PR into smaller changes.'
        },
        {
          reason: 'This PR has a very large diff.',
          suggestion: 'Consider splitting this PR into smaller chunks.'
        }
      ]

      const result = formatValidationIssues(issues)

      expect(result).toBe(`### Issues Found

**1.** This PR changes too many files.

*Suggestion:* Consider breaking this PR into smaller changes.

**2.** This PR has a very large diff.

*Suggestion:* Consider splitting this PR into smaller chunks.`)
    })
  })

  describe('Configuration Management', () => {
    it('should create configuration with defaults', () => {
      const config = createValidationConfig()

      expect(config.maxFilesChanged).toBe(
        DEFAULT_VALIDATION_CONFIG.maxFilesChanged
      )
      expect(config.maxDiffSize).toBe(DEFAULT_VALIDATION_CONFIG.maxDiffSize)
    })

    it('should create configuration with overrides', () => {
      const config = createValidationConfig({
        maxFilesChanged: 100,
        maxDiffSize: 20000
      })

      expect(config.maxFilesChanged).toBe(100)
      expect(config.maxDiffSize).toBe(20000)
      expect(config.maxIndividualFileSize).toBe(
        DEFAULT_VALIDATION_CONFIG.maxIndividualFileSize
      )
    })
  })
})
