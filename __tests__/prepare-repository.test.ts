import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareRepository } from '../src/prepare-repository.ts'
import {
  directoryExists,
  fileExists,
  isGitRepository
} from './utils/fs-utils.ts'

describe('prepareRepository', () => {
  // Use a real, stable public repository for testing
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'

  // Store created temp directories for cleanup
  const createdTempDirs: string[] = []

  beforeEach(() => {
    // Clear the list of created temp directories
    createdTempDirs.length = 0
  })

  afterEach(async () => {
    // Clean up all created temp directories after each test
    for (const dir of createdTempDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true })
      } catch {
        // Ignore errors during cleanup
      }
    }
  })

  it('should create a temporary directory and clone the repository', async () => {
    // Call the function with real parameters
    const result = await prepareRepository(testRepo, testBranch)
    createdTempDirs.push(result)

    // Verify the directory exists
    expect(await directoryExists(result)).toBe(true)

    // Verify it's a git repository
    expect(await isGitRepository(result)).toBe(true)

    // Verify the .aidigestignore file was copied
    expect(await fileExists(path.join(result, '.aidigestignore'))).toBe(true)

    // Verify the function returns a path in the temp directory
    expect(result.startsWith(os.tmpdir())).toBe(true)
    expect(result).toContain('revu-all-')
  }, 30000) // Increase timeout for real git operations

  it('should handle errors when removing the directory', async () => {
    // Create a directory that already exists
    const timestamp = Date.now()
    const existingDir = path.join(os.tmpdir(), `revu-all-${timestamp}`)
    await fs.mkdir(existingDir, { recursive: true })
    createdTempDirs.push(existingDir)

    // Call the function with the same timestamp to test directory removal
    const result = await prepareRepository(testRepo, testBranch, existingDir)

    // Verify the directory exists and is a git repository
    expect(await directoryExists(result)).toBe(true)
    expect(await isGitRepository(result)).toBe(true)

    // Verify the function returns the expected path
    expect(result).toBe(existingDir)
  }, 30000)

  it('should use the provided temp folder when specified', async () => {
    // Create a custom temp folder
    const customTempFolder = path.join(os.tmpdir(), `custom-temp-${Date.now()}`)
    createdTempDirs.push(customTempFolder)

    // Call the function with the custom temp folder
    const result = await prepareRepository(
      testRepo,
      testBranch,
      customTempFolder
    )

    // Verify the directory exists and is a git repository
    expect(await directoryExists(result)).toBe(true)
    expect(await isGitRepository(result)).toBe(true)

    // Verify the .aidigestignore file was copied
    expect(await fileExists(path.join(result, '.aidigestignore'))).toBe(true)

    // Verify the function returns the custom temp folder path
    expect(result).toBe(customTempFolder)
  }, 30000)

  it('should throw an error when git clone fails', async () => {
    // Use a non-existent repository to force a clone failure
    const nonExistentRepo =
      'https://github.com/non-existent/repo-that-does-not-exist.git'

    // Expect the function to throw an error
    await expect(
      prepareRepository(nonExistentRepo, testBranch)
    ).rejects.toThrow()

    // Note: We can't verify the exact error message as it depends on git's output
  }, 30000)

  it('should throw an error when git checkout fails', async () => {
    // Use a non-existent branch to force a checkout failure
    const nonExistentBranch = 'branch-that-does-not-exist'

    // Expect the function to throw an error
    await expect(
      prepareRepository(testRepo, nonExistentBranch)
    ).rejects.toThrow()

    // Note: We can't verify the exact error message as it depends on git's output
  }, 30000)
})
