import type { ExecException, ExecOptions } from 'child_process'
import { ChildProcess } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Set up mocks before importing anything else
vi.mock('child_process', () => ({
  exec: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockImplementation((fn) => fn)
}))

// Import after configuring mocks
import * as childProcess from 'child_process'
import { cloneRepository } from '../src/repo-utils.ts'

/**
 * Exact type for exec callback function
 */
type ExecCallback = (
  error: ExecException | null,
  stdout: string,
  stderr: string
) => void

describe('Private Repository Support', () => {
  const mockExec = vi.mocked(childProcess.exec)

  beforeEach(() => {
    // Reset the mock implementation for each test
    mockExec.mockReset()

    /**
     * Mock implementation that matches Node.js API format,
     * using an explicit cast as needed
     */
    mockExec.mockImplementation(
      (
        _command: string,
        optionsOrCallback?: ExecOptions | ExecCallback,
        callback?: ExecCallback
      ) => {
        // Handle case where options is actually the callback
        if (typeof optionsOrCallback === 'function') {
          callback = optionsOrCallback
        }

        // Call the callback if provided
        if (callback && typeof callback === 'function') {
          callback(null, '', '')
        }

        // Return a minimal object simulating a ChildProcess
        // The cast is necessary since we can't implement all ChildProcess properties in this test context
        return {
          stdout: { on: vi.fn(), pipe: vi.fn() },
          stderr: { on: vi.fn(), pipe: vi.fn() },
          stdin: { on: vi.fn(), pipe: vi.fn() }
        } as unknown as ChildProcess
      }
    )
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('cloneRepository', () => {
    it('should transform URL correctly with token for HTTPS repositories', async () => {
      const repositoryUrl = 'https://github.com/owner/repo.git'
      const destination = '/tmp/test-repo'
      const token = 'github-token-123'

      await cloneRepository({
        repositoryUrl,
        destination,
        token
      })

      // Verify the command includes the token in the correct format
      expect(mockExec).toHaveBeenCalled()
      const command = mockExec.mock.calls[0][0]
      expect(command).toContain(
        `https://x-access-token:${token}@github.com/owner/repo.git`
      )
      // The token is present in the URL for authentication
      expect(command).toContain('github-token-123@')
      expect(command).toContain(`git clone`)
      expect(command).toContain(destination)
    })

    it('should not transform URL when no token is provided', async () => {
      const repositoryUrl = 'https://github.com/owner/repo.git'
      const destination = '/tmp/test-repo'

      await cloneRepository({
        repositoryUrl,
        destination
      })

      // Verify the command uses the original URL
      expect(mockExec).toHaveBeenCalled()
      const command = mockExec.mock.calls[0][0]
      expect(command).toBe(`git clone ${repositoryUrl} ${destination}`)
    })

    it('should include branch option when branch is specified', async () => {
      const repositoryUrl = 'https://github.com/owner/repo.git'
      const destination = '/tmp/test-repo'
      const branch = 'feature-branch'

      await cloneRepository({
        repositoryUrl,
        destination,
        branch
      })

      // Verify the command includes the branch option
      expect(mockExec).toHaveBeenCalled()
      const command = mockExec.mock.calls[0][0]
      expect(command).toBe(
        `git clone ${repositoryUrl} ${destination} --branch ${branch}`
      )
    })

    it('should handle both token and branch correctly', async () => {
      const repositoryUrl = 'https://github.com/owner/repo.git'
      const destination = '/tmp/test-repo'
      const branch = 'feature-branch'
      const token = 'github-token-123'

      await cloneRepository({
        repositoryUrl,
        destination,
        branch,
        token
      })

      // Verify the command includes both token and branch
      expect(mockExec).toHaveBeenCalled()
      const command = mockExec.mock.calls[0][0]
      expect(command).toContain(
        `https://x-access-token:${token}@github.com/owner/repo.git`
      )
      expect(command).toContain(`--branch ${branch}`)
    })
  })
})
