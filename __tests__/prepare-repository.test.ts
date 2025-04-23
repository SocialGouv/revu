import * as fs from 'fs/promises'
import * as os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneRepository, prepareRepository } from '../src/repo-utils.ts'
import {
  directoryExists,
  fileExists,
  isGitRepository
} from './utils/fs-utils.ts'

// Mock child_process.exec
vi.mock('child_process', async () => {
  const actual = (await vi.importActual('child_process')) as object
  return {
    ...actual,
    exec: vi.fn((command, options, callback) => {
      // If it's a callback style, simulate successful execution
      if (callback) {
        callback(null, { stdout: '', stderr: '' })
      }

      // For promise-based usage
      return {
        stdout: '',
        stderr: ''
      }
    })
  }
})

describe('cloneRepository', async () => {
  // Import exec from child_process after mocking
  const { exec } = await import('child_process')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should transform URL when token is provided', async () => {
    const repositoryUrl = 'https://github.com/owner/repo.git'
    const destination = '/tmp/test-repo'
    const token = 'test-token'

    await cloneRepository({
      repositoryUrl,
      destination,
      token
    })

    // Check if exec was called with the transformed URL
    expect(exec).toHaveBeenCalledWith(
      `git clone https://x-access-token:${token}@github.com/owner/repo.git ${destination}`
    )
  })

  it('should not transform URL when no token is provided', async () => {
    const repositoryUrl = 'https://github.com/owner/repo.git'
    const destination = '/tmp/test-repo'

    await cloneRepository({
      repositoryUrl,
      destination
    })

    // Check if exec was called with the original URL
    expect(exec).toHaveBeenCalledWith(
      `git clone ${repositoryUrl} ${destination}`
    )
  })

  it('should add branch option when branch is specified', async () => {
    const repositoryUrl = 'https://github.com/owner/repo.git'
    const destination = '/tmp/test-repo'
    const branch = 'test-branch'

    await cloneRepository({
      repositoryUrl,
      destination,
      branch
    })

    // Check if exec was called with the branch option
    expect(exec).toHaveBeenCalledWith(
      `git clone ${repositoryUrl} ${destination} --branch ${branch}`
    )
  })
})

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

  it('should pass token to cloneRepository when provided', async () => {
    // Mock cloneRepository to verify token is passed correctly
    const originalCloneRepository = cloneRepository
    const mockCloneRepository = vi.fn()
    // @ts-expect-error - Assigning to imported function
    cloneRepository = mockCloneRepository

    try {
      const token = 'test-token'
      const tempFolder = path.join(os.tmpdir(), `token-test-${Date.now()}`)

      // Call prepareRepository with a token
      await prepareRepository(testRepo, testBranch, tempFolder, token)

      // Verify cloneRepository was called with the token
      expect(mockCloneRepository).toHaveBeenCalledWith({
        repositoryUrl: testRepo,
        destination: tempFolder,
        token
      })
    } finally {
      // Restore original function
      // @ts-expect-error - Assigning to imported function
      cloneRepository = originalCloneRepository
    }
  })
})
