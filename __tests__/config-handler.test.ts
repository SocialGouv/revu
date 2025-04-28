import * as fs from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatCodingGuidelines,
  getDefaultConfig,
  readConfig,
  type CodingGuidelinesConfig
} from '../src/config-handler.ts'

// Mock fs.promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn()
}))

// Mock path
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/'))
}))

describe('Config Handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('readConfig', () => {
    it('should return default config when file does not exist', async () => {
      // Mock fs.access to throw an error (file doesn't exist)
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('File not found'))

      const config = await readConfig()
      expect(config).toEqual(getDefaultConfig())
    })

    it('should read and parse YAML config file', async () => {
      // Mock file content
      const mockYamlContent = `
codingGuidelines:
  - "Test guideline 1"
  - "Test guideline 2"
reviewSettings:
  setting1: value1
`
      // Mock successful file access
      vi.mocked(fs.access).mockResolvedValueOnce(undefined)
      // Mock file read
      vi.mocked(fs.readFile).mockResolvedValueOnce(mockYamlContent)

      const config = await readConfig()

      // With ts-deepmerge, arrays are concatenated
      // Default guidelines + YAML file guidelines
      expect(config.codingGuidelines).toEqual([
        'Test coverage: Critical code requires 100% test coverage; non-critical paths require 60% coverage.',
        'Naming: Use semantically significant names for functions, classes, and parameters.',
        'Comments: Add comments only for complex code; simple code should be self-explanatory.',
        'Documentation: Public functions must have concise docstrings explaining purpose and return values.',
        'Test guideline 1',
        'Test guideline 2'
      ])

      expect(config.reviewSettings).toEqual({ setting1: 'value1' })
    })

    it('should return default config on error', async () => {
      // Mock fs.access to succeed but fs.readFile to fail
      vi.mocked(fs.access).mockResolvedValueOnce(undefined)
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('Read error'))

      const config = await readConfig()
      expect(config).toEqual(getDefaultConfig())
    })
  })

  describe('formatCodingGuidelines', () => {
    it('should format guidelines as numbered list', () => {
      const config = {
        codingGuidelines: ['Guideline 1', 'Guideline 2', 'Guideline 3'],
        reviewSettings: {}
      }

      const formatted = formatCodingGuidelines(config)
      expect(formatted).toBe('1. Guideline 1\n2. Guideline 2\n3. Guideline 3')
    })

    it('should handle empty guidelines array', () => {
      const config = {
        codingGuidelines: [],
        reviewSettings: {}
      }

      const formatted = formatCodingGuidelines(config)
      expect(formatted).toBe('No specific coding guidelines defined.')
    })

    it('should handle missing guidelines', () => {
      // Create a config object without codingGuidelines
      const config = {
        reviewSettings: {}
      } as CodingGuidelinesConfig

      const formatted = formatCodingGuidelines(config)
      expect(formatted).toBe('No specific coding guidelines defined.')
    })
  })
})
