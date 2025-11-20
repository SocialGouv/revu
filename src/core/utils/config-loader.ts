import * as fs from 'fs/promises'
import * as path from 'path'
import { DEFAULT_APP_CONFIG, type RevuAppConfig } from '../../types/config.ts'
import { logSystemWarning } from '../../utils/logger.ts'
import { applyRevuAppEnvOverrides } from './env-config.ts'
/**
 * Reads the application configuration from config.json
 */
let cachedConfig: RevuAppConfig | null = null

export async function getAppConfig(): Promise<RevuAppConfig> {
  if (cachedConfig) {
    return cachedConfig
  }
  try {
    const configPath = path.join(process.cwd(), 'config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const fileConfig = JSON.parse(configContent) as Partial<RevuAppConfig>

    // Merge with defaults to ensure all required fields exist
    const merged: RevuAppConfig = {
      ...DEFAULT_APP_CONFIG,
      ...fileConfig
    }

    applyRevuAppEnvOverrides(merged, fileConfig, [
      {
        key: 'llmProvider',
        envVar: 'LLM_PROVIDER',
        parse: (raw) => raw.toLowerCase() as RevuAppConfig['llmProvider'],
        validate: (value) => value === 'anthropic' || value === 'openai',
        onInvalid: (raw) => {
          logSystemWarning(
            new Error(
              'Invalid LLM_PROVIDER env var, expected "anthropic" or "openai"'
            ),
            { context_msg: `value="${raw}"` }
          )
        }
      }
    ])

    cachedConfig = merged
    return cachedConfig
  } catch (error) {
    logSystemWarning('Failed to read config.json, using defaults:', error)

    const fileConfig: Partial<RevuAppConfig> = {}
    const merged: RevuAppConfig = {
      ...DEFAULT_APP_CONFIG
    }

    applyRevuAppEnvOverrides(merged, fileConfig, [
      {
        key: 'llmProvider',
        envVar: 'LLM_PROVIDER',
        parse: (raw) => raw.toLowerCase() as RevuAppConfig['llmProvider'],
        validate: (value) => value === 'anthropic' || value === 'openai',
        onInvalid: (raw) => {
          logSystemWarning(
            new Error(
              'Invalid LLM_PROVIDER env var, expected "anthropic" or "openai"'
            ),
            { context_msg: `value="${raw}"` }
          )
        }
      }
    ])

    cachedConfig = merged
    return cachedConfig
  }
}

// Test helper to reset cached config between test cases
export function _resetAppConfigCacheForTests() {
  cachedConfig = null
}
