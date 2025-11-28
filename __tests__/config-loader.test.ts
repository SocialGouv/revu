import * as fs from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAppConfig,
  _resetAppConfigCacheForTests
} from '../src/core/utils/config-loader.ts'
import type { RevuAppConfig } from '../src/types/config.ts'
import * as logger from '../src/utils/logger.ts'

vi.mock('../src/utils/logger.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/logger.ts')>(
    '../src/utils/logger.ts'
  )
  return {
    ...actual,
    logSystemWarning: vi.fn(actual.logSystemWarning)
  }
})

vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}))

vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/'))
}))

describe('getAppConfig / LLM provider resolution', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetAllMocks()
    process.env = { ...originalEnv }
    _resetAppConfigCacheForTests()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to anthropic when no config.json and no env', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('no file'))

    const cfg = await getAppConfig()
    expect(cfg.llmProvider).toBe('anthropic')
  })

  it('ignores LLM_PROVIDER when config.json is missing (provider resolved at runtime layer)', async () => {
    process.env.LLM_PROVIDER = 'openai'
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('no file'))

    const cfg = await getAppConfig()
    // getAppConfig now only reflects config.json + defaults; provider env
    // resolution is handled in the runtime-config layer.
    expect(cfg.llmProvider).toBe('anthropic')
  })

  it('prefers config.json llmProvider over env', async () => {
    process.env.LLM_PROVIDER = 'openai'

    const fileCfg: Partial<RevuAppConfig> = {
      llmProvider: 'anthropic'
    }
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(fileCfg))

    const cfg = await getAppConfig()
    expect(cfg.llmProvider).toBe('anthropic')
  })

  it('does not fall back to env when config.json omits llmProvider (runtime layer handles env)', async () => {
    process.env.LLM_PROVIDER = 'openai'

    const fileCfg: Partial<RevuAppConfig> = {
      promptStrategy: 'line-comments'
    }
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(fileCfg))

    const cfg = await getAppConfig()
    // getAppConfig remains config.json + defaults; env-based provider
    // fallback is handled by runtime-config.
    expect(cfg.llmProvider).toBe('anthropic')
  })

  it('logs a warning and ignores invalid LLM_PROVIDER', async () => {
    process.env.LLM_PROVIDER = 'invalid-provider'
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('no file'))

    const cfg = await getAppConfig()
    expect(cfg.llmProvider).toBe('anthropic')
    expect(logger.logSystemWarning).toHaveBeenCalled()
  })
})
