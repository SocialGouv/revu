import { getAppConfig } from '../core/utils/config-loader.ts'
import { lineCommentsPromptStrategy } from './line-comments-strategy.ts'
import type { PromptStrategy } from './prompt-strategy.ts'

/**
 * Maps a strategy name to its implementation.
 *
 * @param strategyName - The name of the strategy to get
 * @returns The strategy implementation function
 *
 * Defaults to lineCommentsPromptStrategy if the name is not recognized.
 */
export function getStrategyByName(_strategyName: string): PromptStrategy {
  // There is only one strategy currently available
  // This function can be extended in the future to support multiple strategies
  return lineCommentsPromptStrategy
}

/**
 * Gets the appropriate prompt strategy based on configuration.
 *
 * @param configPath - Path to the configuration file (optional, for backward compatibility)
 * @returns A promise that resolves to the appropriate prompt strategy function
 */
export async function getStrategyFromConfig(): Promise<PromptStrategy> {
  // _configPath parameter is kept for backward compatibility but not used
  // since we now use the centralized config loading
  const config = await getAppConfig()
  return getStrategyByName(config.promptStrategy)
}
