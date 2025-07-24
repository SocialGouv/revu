import type Anthropic from '@anthropic-ai/sdk'
import { logSystemError } from '../../utils/logger.ts'
import type {
  ResponseExtractor,
  ResponseValidator,
  ExtractionResult,
  ResponseProcessorConfig
} from './types.ts'
import {
  createToolUseExtractor,
  createJsonCodeBlockExtractor,
  createJsonTextExtractor,
  createPlainTextExtractor
} from './extractors.ts'
import {
  createBasicJsonValidator,
  createCustomValidator,
  createValidationPipeline,
  createNoOpValidator
} from './validators.ts'

/**
 * Check if content looks like JSON
 */
function isJsonLike(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') && trimmed.endsWith('}')
}

/**
 * Validate an extraction result
 */
function validateResult(
  result: ExtractionResult,
  validator: ResponseValidator,
  contextName: string
): boolean {
  if (!result.isJsonLike) {
    return true // Don't validate non-JSON content
  }

  try {
    const parsed = JSON.parse(result.content)
    const isValid = validator.validate(parsed)

    if (!isValid) {
      console.warn(`JSON response failed custom validation for ${contextName}`)
    }

    return isValid
  } catch (parseError) {
    console.warn(
      `Failed to parse JSON response for ${contextName}:`,
      parseError
    )
    return false
  }
}

/**
 * Select the best extraction result based on priority and validation
 */
function selectBestResult(
  results: ExtractionResult[],
  validator: ResponseValidator,
  contextName: string
): string {
  if (results.length === 0) {
    throw new Error(
      `Unexpected response format from Anthropic ${contextName.toLowerCase()} - no content found`
    )
  }

  // Prioritize JSON-like results first
  const jsonResults = results.filter((result) => result.isJsonLike)
  const nonJsonResults = results.filter((result) => !result.isJsonLike)

  // Try JSON results first
  for (const result of jsonResults) {
    if (validateResult(result, validator, contextName)) {
      console.log(
        `Using ${result.extractorName} result for ${contextName.toLowerCase()}`
      )
      return result.content
    }
  }

  // Fall back to non-JSON results
  for (const result of nonJsonResults) {
    console.warn(
      `${contextName} tool use failed, using ${result.extractorName} fallback`
    )
    return result.content
  }

  // Return the first result as final fallback
  const fallbackResult = results[0]
  console.warn(
    `Returning ${contextName.toLowerCase()} fallback result from ${fallbackResult.extractorName}`
  )
  return fallbackResult.content
}

/**
 * Extract content from message using all available extractors
 */
function extractContent(
  message: Anthropic.Messages.Message,
  extractors: ResponseExtractor[],
  contextName: string
): ExtractionResult[] {
  const extractionResults: ExtractionResult[] = []

  // Try each content block with all extractors
  for (const content of message.content) {
    for (const extractor of extractors) {
      try {
        if (extractor.canHandle(content)) {
          const extracted = extractor.extract(content)
          if (extracted !== null) {
            const isJsonLikeResult = isJsonLike(extracted)
            extractionResults.push({
              content: extracted,
              extractorName: extractor.name,
              isJsonLike: isJsonLikeResult
            })

            // If this is a tool use extraction, return immediately (highest priority)
            if (extractor.name === 'ToolUse') {
              return extractionResults
            }
          }
        }
      } catch (error) {
        if (extractor.name === 'ToolUse') {
          // Re-throw tool use errors as they indicate unexpected responses
          logSystemError(error, {
            context_msg: `Tool use extraction failed for ${contextName}`
          })
          throw error
        }
        // Log other extraction errors but continue
        console.warn(`${extractor.name} extraction failed:`, error)
      }
    }
  }

  return extractionResults
}

/**
 * Create extractors in priority order
 */
function createExtractors(expectedToolName: string): ResponseExtractor[] {
  return [
    createToolUseExtractor(expectedToolName),
    createJsonCodeBlockExtractor(),
    createJsonTextExtractor(),
    createPlainTextExtractor()
  ]
}

/**
 * Create validator pipeline
 */
function createValidator(config: ResponseProcessorConfig): ResponseValidator {
  const validators: ResponseValidator[] = [createBasicJsonValidator()]
  if (config.customValidator) {
    validators.push(createCustomValidator(config.customValidator))
  }
  return validators.length > 1
    ? createValidationPipeline(validators)
    : validators[0] || createNoOpValidator()
}

/**
 * Creates an Anthropic response processor function
 */
export function createAnthropicResponseProcessor(
  config: ResponseProcessorConfig
) {
  const extractors = createExtractors(config.expectedToolName)
  const validator = createValidator(config)

  return function processAnthropicResponse(
    message: Anthropic.Messages.Message
  ): string {
    const extractionResults = extractContent(
      message,
      extractors,
      config.contextName
    )
    return selectBestResult(extractionResults, validator, config.contextName)
  }
}
