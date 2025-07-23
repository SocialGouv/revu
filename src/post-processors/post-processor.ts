/**
 * Interface for post-processing strategies that can refine AI-generated comments
 */
export interface PostProcessor {
  /**
   * Process and refine the comments from the initial AI analysis
   * @param comments - Array of comments from the initial analysis
   * @param context - Additional context that might be needed for processing
   * @returns Promise resolving to refined comments array
   */
  process(
    comments: Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }>,
    context?: {
      prTitle?: string
      prBody?: string
      diff?: string
      codingGuidelines?: string
    }
  ): Promise<
    Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }>
  >
}

/**
 * Configuration for post-processing
 */
export interface PostProcessingConfig {
  enabled: boolean
  model?: string
  strategy?: string
  temperature?: number
  maxTokens?: number
}
