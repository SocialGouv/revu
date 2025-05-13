import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Définir les mocks avant d'importer quoi que ce soit
vi.mock('child_process', () => ({
  exec: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockImplementation((fn) => fn)
}))

// Importer après avoir configuré les mocks
import { cloneRepository } from '../src/repo-utils.ts'
import * as childProcess from 'child_process'

// Type de callback simplifié pour les tests
type ExecCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void

describe('Private Repository Support', () => {
  const mockExec = vi.mocked(childProcess.exec)

  beforeEach(() => {
    // Reset the mock implementation for each test
    mockExec.mockReset()

    // Implémentation du mock avec des types plus génériques
    // @ts-expect-error - Le mock ne retourne pas un ChildProcess complet, mais c'est suffisant pour nos tests
    mockExec.mockImplementation(
      (command: string, options?: unknown, callback?: unknown) => {
        // Handle case where options is actually the callback
        if (typeof options === 'function') {
          callback = options
        }

        // Call the callback if provided
        if (callback && typeof callback === 'function') {
          ;(callback as ExecCallback)(null, '', '')
        }

        // Retourner un objet simple qui simule le minimum nécessaire
        return {
          stdout: { on: vi.fn(), pipe: vi.fn() },
          stderr: { on: vi.fn(), pipe: vi.fn() },
          stdin: { on: vi.fn(), pipe: vi.fn() }
        }
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
