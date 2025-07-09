import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PlatformClient } from '../src/core/models/platform-types.ts'
import {
  PRValidationService,
  DEFAULT_VALIDATION_CONFIG,
  type PRValidationConfig
} from '../src/core/services/pr-validation-service.ts'

// Mock platform client
const createMockClient = (diff: string): PlatformClient => ({
  fetchPullRequestDiff: vi.fn().mockResolvedValue(diff),
  fetchIssueDetails: vi.fn(),
  cloneRepository: vi.fn(),
  createReview: vi.fn(),
  createReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
  getPullRequest: vi.fn(),
  listReviewComments: vi.fn(),
  getReviewComment: vi.fn(),
  deleteReviewComment: vi.fn(),
  fetchPullRequestDiffMap: vi.fn(),
  getFileContent: vi.fn(),
  listReviews: vi.fn()
})

describe('PRValidationService', () => {
  let validationService: PRValidationService
  let mockClient: PlatformClient

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('File Count Validation', () => {
    it('should reject PRs with too many files changed', async () => {
      const diff = Array.from(
        { length: 100 },
        (_, i) =>
          `diff --git a/file${i}.ts b/file${i}.ts\nindex 123..456 100644\n--- a/file${i}.ts\n+++ b/file${i}.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line`
      ).join('\n')

      mockClient = createMockClient(diff)
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        maxFilesChanged: 50
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('100 files')
      expect(result.reason).toContain('exceeds the limit of 50')
      expect(result.metrics.filesChanged).toBe(100)
    })

    it('should accept PRs with acceptable file count', async () => {
      const diff = Array.from(
        { length: 10 },
        (_, i) =>
          `diff --git a/file${i}.ts b/file${i}.ts\nindex 123..456 100644\n--- a/file${i}.ts\n+++ b/file${i}.ts\n@@ -1,1 +1,1 @@\n-old line\n+new line`
      ).join('\n')

      mockClient = createMockClient(diff)
      validationService = new PRValidationService(mockClient)

      const result = await validationService.validatePR(123)

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
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        maxDiffSize: 10000
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('20000 lines of diff')
      expect(result.reason).toContain('exceeds the limit of 10000')
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
      validationService = new PRValidationService(mockClient)

      const result = await validationService.validatePR(123)

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
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        maxIndividualFileSize: 2000
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('4002 lines of changes')
      expect(result.reason).toContain('exceeds the limit of 2000')
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
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        minAdditionDeletionRatio: 0.1
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('cleanup or deletion PR')
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
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        maxAdditionDeletionRatio: 10
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain(
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
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        skipDocumentationOnly: true
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('only changes documentation files')
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
      validationService = new PRValidationService(mockClient, {
        ...DEFAULT_VALIDATION_CONFIG,
        skipDocumentationOnly: false
      })

      const result = await validationService.validatePR(123)

      expect(result.isValid).toBe(true)
    })
  })

  describe('Configuration Management', () => {
    it('should allow updating configuration', () => {
      mockClient = createMockClient('')
      validationService = new PRValidationService(mockClient)

      const newConfig: Partial<PRValidationConfig> = {
        maxFilesChanged: 100,
        maxDiffSize: 20000
      }

      validationService.updateConfig(newConfig)
      const config = validationService.getConfig()

      expect(config.maxFilesChanged).toBe(100)
      expect(config.maxDiffSize).toBe(20000)
      expect(config.maxIndividualFileSize).toBe(
        DEFAULT_VALIDATION_CONFIG.maxIndividualFileSize
      )
    })

    it('should return current configuration', () => {
      const customConfig: PRValidationConfig = {
        ...DEFAULT_VALIDATION_CONFIG,
        maxFilesChanged: 50
      }

      mockClient = createMockClient('')
      validationService = new PRValidationService(mockClient, customConfig)

      const config = validationService.getConfig()
      expect(config.maxFilesChanged).toBe(50)
    })
  })

  describe('Error Handling', () => {
    it('should fail open when validation encounters errors', async () => {
      mockClient = createMockClient('')
      mockClient.fetchPullRequestDiff = vi
        .fn()
        .mockRejectedValue(new Error('API Error'))

      validationService = new PRValidationService(mockClient)

      const result = await validationService.validatePR(123)

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
      validationService = new PRValidationService(mockClient)

      const result = await validationService.validatePR(123)

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
      validationService = new PRValidationService(mockClient)

      const result = await validationService.validatePR(123)

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
      validationService = new PRValidationService(mockClient)

      const result = await validationService.validatePR(123)

      expect(result.metrics.filesChanged).toBe(3)
      expect(result.metrics.reviewableFilesChanged).toBe(3)
      expect(result.metrics.documentationOnlyFiles).toBe(1) // README.md
      expect(result.metrics.additionDeletionRatio).toBeGreaterThan(1) // More additions than deletions
    })
  })
})
