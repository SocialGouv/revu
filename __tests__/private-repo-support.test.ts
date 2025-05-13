import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Le mock doit être déclaré avant les imports
vi.mock('child_process', () => {
  return {
    exec: vi.fn()
  }
})

vi.mock('util', () => {
  return {
    promisify: vi.fn().mockImplementation((fn) => {
      return fn // Retourne simplement la fonction d'origine
    })
  }
})

// Importer après avoir configuré les mocks
import { cloneRepository } from '../src/repo-utils.ts'
import * as childProcess from 'child_process'

describe('Private Repository Support', () => {
  // Récupérer le mock après l'import
  const mockExec = vi.mocked(childProcess.exec)

  beforeEach(() => {
    // Configurer le mock avant chaque test
    mockExec.mockImplementation((command, options, callback) => {
      if (callback) {
        callback(null, { stdout: '', stderr: '' })
      }
      return {
        stdout: { on: vi.fn(), pipe: vi.fn() },
        stderr: { on: vi.fn(), pipe: vi.fn() }
      }
    })
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
      // Le token est présent dans l'URL car il est nécessaire pour l'authentification
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
