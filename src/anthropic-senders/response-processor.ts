import type Anthropic from '@anthropic-ai/sdk'
import { logSystemError } from '../utils/logger.ts'

/**
 * Configuration for processing Anthropic responses
 */
interface ResponseProcessorConfig {
  expectedToolName: string
  contextName: string
  customValidator?: (parsed: unknown) => boolean
}

/**
 * Processes Anthropic API responses with tool use and fallback handling.
 * This shared utility eliminates code duplication across different senders.
 *
 * @param message - The Anthropic API response message
 * @param config - Configuration for processing the response
 * @returns A stringified JSON response
 */
export function processAnthropicResponse<T>(
  message: Anthropic.Messages.Message,
  config: ResponseProcessorConfig
): string {
  let fallbackResult = ''
  let hasJsonFallback = false

  // Extract response from tool use
  for (const content of message.content) {
    if (content.type === 'tool_use') {
      if (content.name === config.expectedToolName && content.input) {
        // Return the structured response as a JSON string
        return JSON.stringify(content.input as T)
      } else {
        const errPayload = {
          name: content.name,
          input: content.input
        }
        logSystemError(
          new Error(
            `Unexpected tool use response: ${JSON.stringify(errPayload)}`
          )
        )
        throw new Error(`Unexpected tool name: ${content.name}`)
      }
    } else if (content.type === 'text') {
      // Fallback if tool use failed or returned unexpected format
      console.warn(
        `${config.contextName} tool use failed, attempting fallback parsing from text response`
      )

      try {
        const text = content.text

        // Try to extract JSON from code blocks first
        const jsonMatch = text.match(/```json\n([\s\S]{1,10000}?)\n```/)
        if (jsonMatch && jsonMatch[1]) {
          console.log('Found JSON in code block, using as fallback')
          fallbackResult = jsonMatch[1].trim()
          hasJsonFallback = true
          continue // Don't overwrite with plain text
        }

        // If the whole response looks like JSON
        const trimmedText = text.trim()
        if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
          try {
            // Validate that it's actually valid JSON
            let parsed
            try {
              parsed = JSON.parse(trimmedText)
            } catch (parseError) {
              console.warn('Failed to parse JSON response:', parseError)
              // For invalid JSON that looks like JSON, still use it as fallback
              // The validation will happen later in the processing chain
              if (!hasJsonFallback) {
                console.log('Using invalid JSON-like text as fallback')
                fallbackResult = trimmedText
                hasJsonFallback = true
              }
              continue
            }

            // Apply custom validation if provided
            if (config.customValidator) {
              if (config.customValidator(parsed)) {
                console.log(
                  'Response appears to be JSON with correct structure, using as fallback'
                )
                fallbackResult = trimmedText
                hasJsonFallback = true
                continue // Don't overwrite with plain text
              } else {
                console.warn(
                  'JSON response failed custom validation:',
                  Object.keys(parsed)
                )
                // Still use it as fallback even if custom validation fails
                if (!hasJsonFallback) {
                  console.log(
                    'Using JSON that failed custom validation as fallback'
                  )
                  fallbackResult = trimmedText
                  hasJsonFallback = true
                }
              }
            } else {
              // Basic structure validation
              if (parsed && typeof parsed === 'object') {
                console.log('Response appears to be JSON, using as fallback')
                fallbackResult = trimmedText
                hasJsonFallback = true
                continue // Don't overwrite with plain text
              } else {
                console.warn('JSON response has invalid structure')
                // Still use it as fallback even if structure validation fails
                if (!hasJsonFallback) {
                  console.log('Using JSON with invalid structure as fallback')
                  fallbackResult = trimmedText
                  hasJsonFallback = true
                }
              }
            }
          } catch (error) {
            console.warn('Text looks like JSON but failed to parse:', error)
            // Use the JSON-like text as fallback even if it failed to parse
            if (!hasJsonFallback) {
              console.log('Using malformed JSON-like text as fallback')
              fallbackResult = trimmedText
              hasJsonFallback = true
            }
          }
        }

        // Only use plain text as fallback if we haven't found JSON
        if (!hasJsonFallback) {
          console.warn('No JSON found, using plain text as fallback')
          fallbackResult = text
        }
      } catch (error) {
        logSystemError(error, {
          context_msg: `Error processing ${config.contextName.toLowerCase()} fallback text`
        })
        // Continue to next content block
      }
    }
  }

  if (fallbackResult) {
    // If we have a fallback result, return it
    console.log(
      `Returning ${config.contextName.toLowerCase()} fallback result, hasJsonFallback:`,
      hasJsonFallback
    )
    return fallbackResult
  }

  throw new Error(
    `Unexpected response format from Anthropic ${config.contextName.toLowerCase()} - no content found`
  )
}
