import * as fs from 'fs/promises'
import * as path from 'path'
import { defaultPromptStrategy } from './default-strategy.ts'
import { modifiedFilesPromptStrategy } from './modified-files-strategy.ts'
import { lineCommentsPromptStrategy } from './line-comments-strategy.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Maps a strategy name to its implementation.
 *
 * @param strategyName - The name of the strategy to get
 * @returns The strategy implementation function
 */
export function getStrategyByName(strategyName: string): PromptStrategy {
  switch (strategyName.toLowerCase()) {
    case 'modified-files':
      return modifiedFilesPromptStrategy
    case 'line-comments':
      return lineCommentsPromptStrategy
    case 'default':
    default:
      return defaultPromptStrategy
  }
}

/**
 * Gets the appropriate prompt strategy based on configuration.
 *
 * @param configPath - Path to the configuration file
 * @returns A promise that resolves to the appropriate prompt strategy function
 */
export async function getStrategyFromConfig(
  configPath = path.join(process.cwd(), 'config.json')
): Promise<PromptStrategy> {
  try {
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(configContent)
    const strategyName = config.promptStrategy || 'default'
    return getStrategyByName(strategyName)
  } catch (error) {
    console.error('Error reading configuration file:', error)
    return defaultPromptStrategy
  }
}
