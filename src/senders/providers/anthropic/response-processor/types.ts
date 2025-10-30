import type Anthropic from '@anthropic-ai/sdk'

/**
 * Configuration for processing Anthropic responses
 */
export interface ResponseProcessorConfig {
  expectedToolName: string
  contextName: string
  customValidator?: (parsed: unknown) => boolean
}

/**
 * Interface for response extraction strategies
 */
export interface ResponseExtractor {
  readonly name: string
  canHandle(content: Anthropic.Messages.ContentBlock): boolean
  extract(content: Anthropic.Messages.ContentBlock): string | null
}

/**
 * Interface for response validation strategies
 */
export interface ResponseValidator {
  validate(parsed: unknown): boolean
}

/**
 * Result from extraction attempt
 */
export interface ExtractionResult {
  content: string
  extractorName: string
  isJsonLike: boolean
}
