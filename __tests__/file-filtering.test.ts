import { describe, expect, it, vi } from 'vitest'
import type { PlatformClient } from '../src/core/models/platform-types.ts'
import { filterIgnoredFiles } from '../src/file-utils.ts'

describe('file filtering', () => {
  describe('filterIgnoredFiles', () => {
    it('should filter files based on remote .revuignore patterns', async () => {
      // Create a mock client that returns .revuignore content
      const revuIgnoreContent = `
*.lock
pnpm-lock.yaml
dist/
node_modules/
*.min.js
`
      const mockClient = {
        getFileContent: vi.fn().mockResolvedValue(revuIgnoreContent)
      } as unknown as PlatformClient

      const filePaths = [
        'src/index.ts',
        'package.json',
        'pnpm-lock.yaml',
        'dist/bundle.js',
        'dist/styles.css',
        'node_modules/react/index.js',
        'src/utils.min.js',
        'README.md'
      ]

      const filteredFiles = await filterIgnoredFiles(
        filePaths,
        mockClient,
        'abc123'
      )

      expect(filteredFiles).toEqual([
        'src/index.ts',
        'package.json',
        'README.md'
      ])

      expect(mockClient.getFileContent).toHaveBeenCalledWith(
        '.revuignore',
        'abc123'
      )
    })

    it('should fall back to default .revuignore when remote file does not exist', async () => {
      // Create a mock client that throws an error (file not found)
      const mockClient = {
        getFileContent: vi.fn().mockRejectedValue(new Error('File not found'))
      } as unknown as PlatformClient

      const filePaths = ['src/index.ts', 'package.json', 'pnpm-lock.yaml']

      // This will fall back to the default .revuignore in the project root
      const filteredFiles = await filterIgnoredFiles(
        filePaths,
        mockClient,
        'abc123'
      )

      // lockfiles should be filtered out by the default .revuignore
      expect(filteredFiles).toEqual(['src/index.ts', 'package.json'])

      expect(mockClient.getFileContent).toHaveBeenCalledWith(
        '.revuignore',
        'abc123'
      )
    })

    it('should handle empty file list', async () => {
      const mockClient = {
        getFileContent: vi.fn().mockResolvedValue('')
      } as unknown as PlatformClient

      const filteredFiles = await filterIgnoredFiles([], mockClient, 'abc123')

      expect(filteredFiles).toEqual([])
    })
  })
})
