import type { PostProcessor, PostProcessingConfig } from './post-processor.ts'
import { CommentRefinementProcessor } from './comment-refinement-processor.ts'

/**
 * Factory function to create post-processors based on configuration
 */
export function createPostProcessor(
  config: PostProcessingConfig
): PostProcessor | null {
  if (!config.enabled) {
    return null
  }

  switch (config.strategy) {
    case 'comment-refinement':
      return new CommentRefinementProcessor(config)
    default:
      console.warn(
        `Unknown post-processing strategy: ${config.strategy}, disabling post-processing`
      )
      return null
  }
}

// Re-export types for convenience
export type { PostProcessor, PostProcessingConfig } from './post-processor.ts'
