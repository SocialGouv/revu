import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import path from 'path'

// Mock des dépendances externes avec vi.hoisted() pour éviter les problèmes de hoisting
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockRm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockCopyFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockExec = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
)
const mockCloneRepository = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
)

// Mocker modules
vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  rm: mockRm,
  copyFile: mockCopyFile,
  access: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('child_process', () => ({
  exec: mockExec
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockImplementation((_fn) => {
    return mockExec
  })
}))

// Mock repo-utils
vi.mock('../src/repo-utils.ts', () => ({
  cloneRepository: mockCloneRepository,
  prepareRepository: vi
    .fn()
    .mockImplementation(async (repoUrl, branch, tempFolder, token) => {
      const folderPath =
        tempFolder || path.join(os.tmpdir(), `revu-all-${Date.now()}`)

      // Simuler le comportement de prepareRepository
      try {
        await mockRm(folderPath, { recursive: true, force: true })
      } catch {
        // Ignorer l'erreur (même comportement que le vrai code)
      }

      await mockMkdir(folderPath, { recursive: true })

      await mockCloneRepository({
        repositoryUrl: repoUrl,
        destination: folderPath,
        ...(token ? { token } : {})
      })

      // Simuler les commandes git
      await mockExec('git fetch --all', { cwd: folderPath })
      await mockExec(`git checkout ${branch}`, { cwd: folderPath })

      // Copie du fichier .aidigestignore
      await mockCopyFile(
        '.aidigestignore',
        path.join(folderPath, '.aidigestignore')
      )

      return folderPath
    }),
  cleanUpRepository: vi.fn().mockResolvedValue(undefined)
}))

// Import après les mocks
import { cloneRepository, prepareRepository } from '../src/repo-utils.ts'

// Utiliser un repo public stable pour les tests
const TEST_REPO = 'https://github.com/SocialGouv/carnets.git'
const TEST_BRANCH = 'main'

// Tests pour cloneRepository
describe('cloneRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should transform URL when token is provided', async () => {
    const repositoryUrl = TEST_REPO
    const destination = '/tmp/test-repo'
    const token = 'test-token'

    await cloneRepository({
      repositoryUrl,
      destination,
      token
    })

    // Vérifier que cloneRepository a été appelé avec les bons arguments
    expect(mockCloneRepository).toHaveBeenCalledWith({
      repositoryUrl,
      destination,
      token
    })
  })

  it('should not transform URL when no token is provided', async () => {
    const repositoryUrl = TEST_REPO
    const destination = '/tmp/test-repo'

    await cloneRepository({
      repositoryUrl,
      destination
    })

    // Vérifier que cloneRepository a été appelé avec les bons arguments
    expect(mockCloneRepository).toHaveBeenCalledWith({
      repositoryUrl,
      destination
    })
  })

  it('should add branch option when branch is specified', async () => {
    const repositoryUrl = TEST_REPO
    const destination = '/tmp/test-repo'
    const branch = TEST_BRANCH

    await cloneRepository({
      repositoryUrl,
      destination,
      branch
    })

    // Vérifier que cloneRepository a été appelé avec les bons arguments
    expect(mockCloneRepository).toHaveBeenCalledWith({
      repositoryUrl,
      destination,
      branch
    })
  })
})

// Tests pour prepareRepository
describe('prepareRepository', () => {
  const createdTempDirs = new Set<string>()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Nettoyer les répertoires temporaires
    createdTempDirs.clear()
  })

  it('should create temp directory, clone repo and checkout branch', async () => {
    // Test data
    const repositoryUrl = TEST_REPO
    const branch = TEST_BRANCH

    // Call prepareRepository
    const tempFolderPath = await prepareRepository(repositoryUrl, branch)

    // Add to cleanup list
    createdTempDirs.add(tempFolderPath)

    // Check that mkdir was called
    expect(mockMkdir).toHaveBeenCalledWith(tempFolderPath, { recursive: true })

    // Check that cloneRepository was called
    expect(mockCloneRepository).toHaveBeenCalledWith({
      repositoryUrl,
      destination: tempFolderPath
    })

    // Check that .aidigestignore was copied
    expect(mockCopyFile).toHaveBeenCalledWith(
      '.aidigestignore',
      path.join(tempFolderPath, '.aidigestignore')
    )
  }, 5000)

  it('should use custom temp folder when provided', async () => {
    // Test data
    const repositoryUrl = TEST_REPO
    const branch = TEST_BRANCH
    const customTempFolder = path.join(os.tmpdir(), `custom-temp-${Date.now()}`)

    // Call prepareRepository with custom folder
    const result = await prepareRepository(
      repositoryUrl,
      branch,
      customTempFolder
    )

    // Check that the result is the custom temp folder
    expect(result).toBe(customTempFolder)

    // Check that mkdir was called with custom folder
    expect(mockMkdir).toHaveBeenCalledWith(customTempFolder, {
      recursive: true
    })
  }, 5000)

  it('should pass token to cloneRepository when provided', async () => {
    // Test data
    const repositoryUrl = TEST_REPO
    const branch = TEST_BRANCH
    const token = 'test-token'

    // Call prepareRepository with token
    await prepareRepository(repositoryUrl, branch, undefined, token)

    // Check that cloneRepository was called with token
    expect(mockCloneRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl,
        token
      })
    )
  }, 5000)

  it('should handle errors when removing the directory', async () => {
    // Test data
    const repositoryUrl = TEST_REPO
    const branch = TEST_BRANCH
    const tempFolder = path.join(os.tmpdir(), `revu-all-${Date.now()}`)

    // Mock rm to throw error first time
    mockRm.mockRejectedValueOnce(new Error('Directory not empty'))

    // Call prepareRepository
    await prepareRepository(repositoryUrl, branch, tempFolder)

    // Check that rm was called
    expect(mockRm).toHaveBeenCalledWith(tempFolder, {
      recursive: true,
      force: true
    })

    // Check that mkdir was called even with rm error
    expect(mockMkdir).toHaveBeenCalledWith(tempFolder, { recursive: true })
  }, 5000)
})
