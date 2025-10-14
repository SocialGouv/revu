import { ChildProcess } from 'child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Set up mocks before importing anything else
vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockImplementation((fn) => fn)
}))

// Import after configuring mocks
import * as childProcess from 'child_process'
import { cloneRepository } from '../src/repo-utils.ts'

describe('Private Repository Support', () => {
  const mockSpawn = vi.mocked(childProcess.spawn)

  beforeEach(() => {
    // Reset the mock implementation for each test
    mockSpawn.mockReset()

    /**
     * Mock implementation that matches Node.js spawn API signature
     */
    mockSpawn.mockImplementation(
      (_command: string, _args?: readonly string[], _options?: any) => {
        // Return a minimal object simulating a ChildProcess returned by spawn
        const mockProcess = {
          stdout: { on: vi.fn(), pipe: vi.fn() },
          stderr: {
            on: vi.fn((_event: string, _handler: (data: Buffer) => void) => {
              // Don't call the handler, simulating successful execution with no stderr
              return mockProcess.stderr
            }),
            pipe: vi.fn()
          },
          stdin: { on: vi.fn(), pipe: vi.fn() },
          on: vi.fn((event: string, handler: (code: number) => void) => {
            // Simulate successful completion
            if (event === 'close') {
              // Call close handler with exit code 0 (success)
              setImmediate(() => handler(0))
            }
            return mockProcess
          })
        } as unknown as ChildProcess

        return mockProcess
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

      // Verify spawn was called with correct arguments
      expect(mockSpawn).toHaveBeenCalled()
      const args = mockSpawn.mock.calls[0][1] as string[]

      // Check that the args contain the authenticated URL
      const urlArg = args.find((arg) => arg.includes('github.com'))
      expect(urlArg).toContain(
        `https://x-access-token:${token}@github.com/owner/repo.git`
      )
      expect(urlArg).toContain('github-token-123@')

      // Check that clone command and destination are in the args
      expect(args).toContain('clone')
      expect(args).toContain(destination)
    })

    it('should not transform URL when no token is provided', async () => {
      const repositoryUrl = 'https://github.com/owner/repo.git'
      const destination = '/tmp/test-repo'

      await cloneRepository({
        repositoryUrl,
        destination
      })

      // Verify spawn was called with the original URL
      expect(mockSpawn).toHaveBeenCalled()
      const args = mockSpawn.mock.calls[0][1] as string[]

      expect(args).toContain('clone')
      expect(args).toContain(repositoryUrl)
      expect(args).toContain(destination)
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

      // Verify spawn was called with the branch option
      expect(mockSpawn).toHaveBeenCalled()
      const args = mockSpawn.mock.calls[0][1] as string[]

      expect(args).toContain('clone')
      expect(args).toContain(repositoryUrl)
      expect(args).toContain(destination)
      expect(args).toContain('--branch')
      expect(args).toContain(branch)
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

      // Verify spawn was called with both token and branch
      expect(mockSpawn).toHaveBeenCalled()
      const args = mockSpawn.mock.calls[0][1] as string[]

      // Check that the args contain the authenticated URL
      const urlArg = args.find((arg) => arg.includes('github.com'))
      expect(urlArg).toContain(
        `https://x-access-token:${token}@github.com/owner/repo.git`
      )

      // Check that branch option is present
      expect(args).toContain('--branch')
      expect(args).toContain(branch)
    })
  })
})
