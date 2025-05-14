import * as fs from 'fs/promises'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractModifiedFilePaths, getFilesContent } from '../src/file-utils.ts'

// Mock fs module
vi.mock('fs/promises')

describe('getFilesContent', () => {
  const mockRepoPath = '/mock/repo'

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should read file contents successfully', async () => {
    // Mock implementation
    vi.mocked(fs.readFile).mockImplementation((filePath) => {
      if (String(filePath).includes('file1.txt')) {
        return Promise.resolve('content of file1')
      }
      if (String(filePath).includes('file2.txt')) {
        return Promise.resolve('content of file2')
      }
      return Promise.reject(new Error('File not found'))
    })

    const filePaths = ['file1.txt', 'file2.txt']
    const result = await getFilesContent(filePaths, mockRepoPath)

    // Verify results
    expect(result).toEqual({
      'file1.txt': 'content of file1',
      'file2.txt': 'content of file2'
    })

    // Verify fs.readFile was called with correct paths
    expect(fs.readFile).toHaveBeenCalledTimes(2)
    expect(fs.readFile).toHaveBeenCalledWith(
      path.join(mockRepoPath, 'file1.txt'),
      'utf-8'
    )
    expect(fs.readFile).toHaveBeenCalledWith(
      path.join(mockRepoPath, 'file2.txt'),
      'utf-8'
    )
  })

  it('should handle file read errors', async () => {
    // Mock console.error to prevent test output pollution
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    // Mock implementation with error
    vi.mocked(fs.readFile).mockImplementation((filePath) => {
      if (String(filePath).includes('file1.txt')) {
        return Promise.resolve('content of file1')
      }
      return Promise.reject(new Error('File not found'))
    })

    const filePaths = ['file1.txt', 'nonexistent.txt']
    const result = await getFilesContent(filePaths, mockRepoPath)

    // Verify results
    expect(result['file1.txt']).toBe('content of file1')

    // Verify console.error was called
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    // Restore console.error
    consoleErrorSpy.mockRestore()
  })
})

describe('extractModifiedFilePaths', () => {
  it('should extract modified file paths from git diff', () => {
    const mockDiff = `
diff --git a/file1.txt b/file1.txt
index 1234567..abcdefg 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,3 +1,4 @@
 Line 1
 Line 2
+Line 3
 Line 4

diff --git a/file2.txt b/file2.txt
index 7654321..gfedcba 100644
--- a/file2.txt
+++ b/file2.txt
@@ -1,2 +1,2 @@
-Old line
+New line
 Another line
`
    const result = extractModifiedFilePaths(mockDiff)

    expect(result).toEqual(['file1.txt', 'file2.txt'])
    expect(result.length).toBe(2)
  })
})
