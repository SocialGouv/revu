import * as fs from 'fs/promises'
import * as path from 'path'
import { DEFAULT_APP_CONFIG, type RevuAppConfig } from '../../types/config.ts'
import { logSystemWarning } from '../../utils/logger.ts'
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

    cachedConfig = merged
    return cachedConfig
  } catch (error) {
    logSystemWarning('Failed to read config.json, using defaults:', error)

    const merged: RevuAppConfig = {
      ...DEFAULT_APP_CONFIG
    }

    cachedConfig = merged
    return cachedConfig
  }
}

// Test helper to reset cached config between test cases
export function _resetAppConfigCacheForTests() {
  cachedConfig = null
}
