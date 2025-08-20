import type Anthropic from '@anthropic-ai/sdk'
import { logSystemError, logSystemWarning } from '../../utils/logger.ts'
import {
  createJsonCodeBlockExtractor,
  createJsonTextExtractor,
  createPlainTextExtractor,
  createToolUseExtractor
} from './extractors.ts'
import type {
  ExtractionResult,
  ResponseExtractor,
  ResponseProcessorConfig,
  ResponseValidator
} from './types.ts'
import {
  createBasicJsonValidator,
  createCustomValidator,
  createNoOpValidator,
  createValidationPipeline
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
function validateJsonContent(
  result: ExtractionResult,
  validator: ResponseValidator,
  contextName: string
): boolean {
  try {
    const parsedJSON = JSON.parse(result.content)
    const isValid = validator.validate(parsedJSON)

    if (!isValid) {
      logSystemWarning(
        `JSON response failed custom validation for ${contextName}`
      )
    }

    return isValid
  } catch (parseError) {
    logSystemWarning(
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
    if (validateJsonContent(result, validator, contextName)) {
      console.log(
        `Using ${result.extractorName} result for ${contextName.toLowerCase()}`
      )
      return result.content
    }
  }

  // Fall back to first non-JSON result if available
  if (nonJsonResults.length > 0) {
    const result = nonJsonResults[0]
    logSystemWarning(
      `${contextName} tool use failed, using ${result.extractorName} fallback`
    )
    return result.content
  }

  // Return the first result as final fallback
  const fallbackResult = results[0]
  logSystemWarning(
    `Returning ${contextName.toLowerCase()} fallback result from ${fallbackResult.extractorName}`
  )
  return fallbackResult.content
}

/**
 * Attempt to extract content using a single extractor on a single content block
 */
function tryExtractWithExtractor(
  content: Anthropic.Messages.ContentBlock,
  extractor: ResponseExtractor,
  contextName: string
): ExtractionResult | null {
  try {
    if (!extractor.canHandle(content)) {
      return null
    }

    const extracted = extractor.extract(content)
    if (extracted === null) {
      return null
    }

    return {
      content: extracted,
      extractorName: extractor.name,
      isJsonLike: isJsonLike(extracted)
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
    logSystemWarning(`${extractor.name} extraction failed:`, error)
    return null
  }
}

/**
 * Process a single content block with all available extractors
 */
function processContentBlock(
  content: Anthropic.Messages.ContentBlock,
  extractors: ResponseExtractor[],
  contextName: string
): ExtractionResult[] {
  const results: ExtractionResult[] = []

  for (const extractor of extractors) {
    const result = tryExtractWithExtractor(content, extractor, contextName)
    if (result !== null) {
      results.push(result)

      // Return immediately because it is highest priority
      if (extractor.name === 'ToolUse') {
        return results
      }
    }
  }

  return results
}

/**
 * Extract content from message using all available extractors
 */
function extractMessageContent(
  message: Anthropic.Messages.Message,
  extractors: ResponseExtractor[],
  contextName: string
): ExtractionResult[] {
  const extractionResults: ExtractionResult[] = []

  // Try each content block with all extractors (there should be only one block though)
  for (const content of message.content) {
    const blockResults = processContentBlock(content, extractors, contextName)
    extractionResults.push(...blockResults)

    // If we found a ToolUse result, return immediately
    if (blockResults.some((result) => result.extractorName === 'ToolUse')) {
      return extractionResults
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
    const extractionResults = extractMessageContent(
      message,
      extractors,
      config.contextName
    )
    return selectBestResult(extractionResults, validator, config.contextName)
  }
}
