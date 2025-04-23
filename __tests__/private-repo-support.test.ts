import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cloneRepository } from '../src/repo-utils.ts'
import * as childProcess from 'child_process'

// Mock the execAsync function to test URL transformation with tokens
vi.mock('child_process', () => {
  return {
    exec: vi.fn((command, options, callback) => {
      if (callback) {
        callback(null, { stdout: '', stderr: '' })
      }
      return {
        stdout: '',
        stderr: ''
      }
    })
  }
})

vi.mock('util', () => {
  return {
    promisify: vi.fn().mockImplementation((fn) => {
      return fn
    })
  }
})

describe('Private Repository Support', () => {
  const mockExec = vi.spyOn(childProcess, 'exec')

  beforeEach(() => {
    mockExec.mockClear()
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

      // Verify the command includes the token in the right format
      expect(mockExec).toHaveBeenCalled()
      const command = mockExec.mock.calls[0][0]
      expect(command).toContain(
        `https://x-access-token:${token}@github.com/owner/repo.git`
      )
      expect(command).not.toContain('github-token-123@')
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
