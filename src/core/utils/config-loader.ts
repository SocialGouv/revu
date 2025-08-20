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
    const config = JSON.parse(configContent) as Partial<RevuAppConfig>

    // Merge with defaults to ensure all required fields exist
    cachedConfig = {
      ...DEFAULT_APP_CONFIG,
      ...config
    }
    return cachedConfig
  } catch (error) {
    logSystemWarning('Failed to read config.json, using defaults:', error)
    cachedConfig = DEFAULT_APP_CONFIG
    return cachedConfig
  }
}
