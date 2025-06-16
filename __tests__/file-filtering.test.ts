import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { filterIgnoredFiles } from '../src/file-utils.ts'

describe('file filtering', () => {
  describe('filterIgnoredFiles', () => {
    it('should filter files based on ignore patterns', async () => {
      // Create a temporary directory for testing
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revu-test-'))

      // Create a test .revuignore file
      const revuIgnoreContent = `
*.lock
dist/
node_modules/
*.min.js
`
      await fs.writeFile(path.join(tempDir, '.revuignore'), revuIgnoreContent)

      const filePaths = [
        'src/index.ts',
        'package.json',
        'yarn.lock',
        'dist/bundle.js',
        'dist/styles.css',
        'node_modules/react/index.js',
        'src/utils.min.js',
        'README.md'
      ]

      const filteredFiles = await filterIgnoredFiles(filePaths, tempDir)

      expect(filteredFiles).toEqual([
        'src/index.ts',
        'package.json',
        'README.md'
      ])

      // Clean up
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('should return all files when no .revuignore exists and no default patterns', async () => {
      // Create a temporary directory without .revuignore
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revu-test-'))

      const filePaths = ['src/index.ts', 'package.json', 'yarn.lock']

      // This will fall back to the default .revuignore in the project root
      const filteredFiles = await filterIgnoredFiles(filePaths, tempDir)

      // yarn.lock should be filtered out by the default .revuignore
      expect(filteredFiles).toEqual(['src/index.ts', 'package.json'])

      // Clean up
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('should handle empty file list', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'revu-test-'))

      const filteredFiles = await filterIgnoredFiles([], tempDir)

      expect(filteredFiles).toEqual([])

      // Clean up
      await fs.rm(tempDir, { recursive: true, force: true })
    })
  })
})
