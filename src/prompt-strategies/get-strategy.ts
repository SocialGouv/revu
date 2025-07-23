import * as fs from 'fs/promises'
import * as path from 'path'
import { logSystemError } from '../utils/logger.ts'
import { lineCommentsPromptStrategy } from './line-comments-strategy.ts'
import { reviewPlanningPromptStrategy } from './planning-strategy.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Maps a strategy name to its implementation.
 *
 * @param strategyName - The name of the strategy to get
 * @returns The strategy implementation function
 */
export function getStrategyByName(strategyName: string): PromptStrategy {
  switch (strategyName.toLowerCase()) {
    case 'review-planning':
      return reviewPlanningPromptStrategy
    case 'line-comments':
      return lineCommentsPromptStrategy
    default:
      return lineCommentsPromptStrategy
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
    logSystemError(error, {
      context_msg:
        'Failed to read configuration file to get strategy name, using default strategy (line-comments)'
    })
    return lineCommentsPromptStrategy
  }
}
