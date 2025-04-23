import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractAll, extractAllFromUrl } from '../src/extract-all.ts'
import { cleanUpRepository, prepareRepository } from '../src/repo-utils.ts'

// Mock repo-utils to avoid actual clone operations in unit tests for extractAllFromUrl
vi.mock('../src/repo-utils.ts', async () => {
  const actual = await vi.importActual('../src/repo-utils.ts')
  return {
    ...actual,
    prepareRepository: vi
      .fn()
      .mockImplementation(
        async (_repositoryUrl, _branch, _tempFolder, _token) => {
          return '/mocked/repo/path'
        }
      ),
    cleanUpRepository: vi.fn().mockImplementation(async (_repoPath) => {
      // Mock implementation, do nothing
    })
  }
})

describe('extractAll', async () => {
  const testRepo = 'https://github.com/SocialGouv/carnets.git'
  const testBranch = 'ai-digest'
  let repoPath: string

  beforeEach(async () => {
    repoPath = await prepareRepository(testRepo, testBranch)
  })

  afterEach(async () => {
    await cleanUpRepository(repoPath)
  })

  it('should extract all information from a single clone', async () => {
    const result = await extractAll({
      branch: testBranch,
      repoPath: repoPath
    })

    // Verify codebase contains expected content
    expect(result.codebase).toBeTruthy()
    expect(result.codebase).toContain('```') // Should contain code blocks

    // Verify diff has correct git diff format
    expect(result.diff).toBeTruthy()
    expect(result.diff).toMatch(/^diff --git/m) // Should start with git diff header
    expect(result.diff).toMatch(/^@@.*@@/m) // Should contain diff hunks
    expect(result.diff).toMatch(/^[-+]/m) // Should contain additions/deletions

    // Verify log has correct git log format
    expect(result.log).toBeTruthy()
    expect(result.log).toMatch(/[a-f0-9]+ - .+, .+ : .+/) // Should match git log format
  }, 60000) // Increase timeout to 60s since we're doing three operations
})

// Mock extractAll for the extractAllFromUrl tests
beforeEach(() => {
  vi.mock('../src/extract-all.ts')
  vi.mocked(extractAll).mockResolvedValue({
    codebase: 'mock codebase content',
    diff: 'mock diff content',
    log: 'mock log content'
  })
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('extractAllFromUrl', () => {
  it('should correctly pass parameters to prepareRepository and extractAll', async () => {
    const repositoryUrl = 'https://github.com/example/repo.git'
    const branch = 'main'
    const token = 'test-token'

    const result = await extractAllFromUrl({
      repositoryUrl,
      branch,
      token
    })

    // Verify prepareRepository was called with the correct parameters
    expect(prepareRepository).toHaveBeenCalledWith(
      repositoryUrl,
      branch,
      expect.any(String), // tempFolder is generated dynamically
      token
    )

    // Verify extractAll was called with the correct parameters
    expect(extractAll).toHaveBeenCalledWith({
      branch,
      repoPath: '/mocked/repo/path' // This is the return value from our mocked prepareRepository
    })

    // Verify the result structure
    expect(result).toEqual({
      codebase: 'mock codebase content',
      diff: 'mock diff content',
      log: 'mock log content'
    })
  })

  it('should clean up repository after extraction', async () => {
    await extractAllFromUrl({
      repositoryUrl: 'https://github.com/example/repo.git',
      branch: 'main'
    })

    // Verify cleanUpRepository was called
    expect(cleanUpRepository).toHaveBeenCalledWith('/mocked/repo/path')
  })

  it('should clean up repository even if extraction fails', async () => {
    // Mock extractAll to throw an error
    vi.mocked(extractAll).mockRejectedValueOnce(new Error('Test error'))

    // Verify the function rejects
    await expect(
      extractAllFromUrl({
        repositoryUrl: 'https://github.com/example/repo.git',
        branch: 'main'
      })
    ).rejects.toThrow('Test error')

    // Verify cleanUpRepository was still called
    expect(cleanUpRepository).toHaveBeenCalledWith('/mocked/repo/path')
  })
})
