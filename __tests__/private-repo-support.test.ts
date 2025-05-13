import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ChildProcess } from 'child_process'
import type { ExecOptions, ExecException } from 'child_process'

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

/**
 * Type exact pour la fonction callback d'exec
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
     * Implémentation du mock qui respecte le format de l'API Node.js
     * en utilisant un cast nécessaire mais explicite
     */
    mockExec.mockImplementation(
      (
        command: string,
        optionsOrCallback?: ExecOptions | ExecCallback,
        callback?: ExecCallback
      ) => {
        // Gérer le cas où options est en fait le callback
        if (typeof optionsOrCallback === 'function') {
          callback = optionsOrCallback
        }

        // Appeler le callback si fourni
        if (callback && typeof callback === 'function') {
          callback(null, '', '')
        }

        // Retourner un objet minimal qui simule un ChildProcess
        // Le cast est nécessaire ici car nous ne pouvons pas implémenter
        // toutes les propriétés de ChildProcess dans ce contexte de test
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
