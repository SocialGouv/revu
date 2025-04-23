import { beforeEach, describe, expect, it, vi } from 'vitest'

// Import des fonctions à tester
import { extractAllFromUrl } from '../src/extract-all.ts'
import { prepareRepository, cleanUpRepository } from '../src/repo-utils.ts'

// Mocks
vi.mock('../src/repo-utils.ts', () => ({
  prepareRepository: vi.fn().mockResolvedValue('/mocked/repo/path'),
  cleanUpRepository: vi.fn().mockResolvedValue(undefined)
}))

// Mock pour les fonctions d'extraction
vi.mock('../src/extract-codebase.ts', () => ({
  extractCodebaseFromRepo: vi.fn().mockResolvedValue('mock codebase')
}))

vi.mock('../src/extract-diff.ts', () => ({
  extractDiffFromRepo: vi.fn().mockResolvedValue('mock diff')
}))

vi.mock('../src/extract-log.ts', () => ({
  extractLogFromRepo: vi.fn().mockResolvedValue('mock log')
}))

// Import de extractCodebaseFromRepo après avoir mockée
import { extractCodebaseFromRepo } from '../src/extract-codebase.ts'

// Tests
describe('extractAllFromUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 1: Vérification normale du flux de travail
  it('should use prepareRepository and cleanUpRepository', async () => {
    // Arrange
    const repositoryUrl = 'https://github.com/test/repo.git'
    const branch = 'main'
    const token = 'test-token'

    // Act
    const result = await extractAllFromUrl({
      repositoryUrl,
      branch,
      token
    })

    // Assert
    expect(prepareRepository).toHaveBeenCalledWith(
      repositoryUrl,
      branch,
      expect.any(String),
      token
    )

    expect(cleanUpRepository).toHaveBeenCalledWith('/mocked/repo/path')

    // Vérifier que le résultat est un objet avec les bonnes propriétés
    expect(result).toHaveProperty('codebase')
    expect(result).toHaveProperty('diff')
    expect(result).toHaveProperty('log')
  })

  // Test 2: Vérification de gestion d'erreur
  it('should clean up repository even if extraction fails', async () => {
    // Simuler une erreur lors de l'extraction du codebase
    vi.mocked(extractCodebaseFromRepo).mockRejectedValueOnce(
      new Error('Test error')
    )

    // Act & Assert
    await expect(
      extractAllFromUrl({
        repositoryUrl: 'https://github.com/test/repo.git',
        branch: 'main'
      })
    ).rejects.toThrow('Test error')

    // Vérifier que le nettoyage a été appelé malgré l'erreur
    expect(cleanUpRepository).toHaveBeenCalledWith('/mocked/repo/path')
  })
})
