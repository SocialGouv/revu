/**
 * Configuration interface for the Revu application
 */
export interface RevuAppConfig {
  /**
   * The prompt strategy to use for code review
   */
  promptStrategy: string

  /**
   * Whether to enable Anthropic's extended thinking capabilities
   */
  thinkingEnabled?: boolean
}

/**
 * Default configuration values
 */
export const DEFAULT_APP_CONFIG: RevuAppConfig = {
  promptStrategy: 'line-comments',
  thinkingEnabled: false
}
