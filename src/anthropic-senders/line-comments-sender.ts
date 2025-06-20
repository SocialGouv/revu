import Anthropic from '@anthropic-ai/sdk'

// Type for code review response
interface CodeReviewResponse {
  summary: string
  comments: Array<{
    path: string
    line: number
    start_line?: number
    body: string
    suggestion?: string
  }>
}

/**
 * Line comments Anthropic sender.
 * This sender uses Anthropic's Tool Use / Function Calling capability
 * to enforce a structured JSON response with specific line-based comments.
 *
 * @param prompt - The prompt to send to Anthropic
 * @returns A stringified JSON response containing structured review comments
 */
export async function lineCommentsSender(prompt: string): Promise<string> {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Send to Anthropic API with tool use configuration
  const message = await anthropic.messages.create({
    model: 'claude-3-7-sonnet-latest',
    max_tokens: 4096,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    tools: [
      {
        name: 'provide_code_review',
        description:
          'Provide structured code review with line-specific comments',
        input_schema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Overall summary of the PR'
            },
            comments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'File path relative to repository root'
                  },
                  line: {
                    type: 'integer',
                    description:
                      'End line number for the comment (or single line if start_line not provided)'
                  },
                  start_line: {
                    type: 'integer',
                    description:
                      'Start line number for multi-line comments (optional). Must be <= line.'
                  },
                  body: {
                    type: 'string',
                    description: 'Detailed comment about the issue'
                  },
                  suggestion: {
                    type: 'string',
                    description: 'Suggested code to fix the issue (optional)'
                  }
                },
                required: ['path', 'line', 'body']
              }
            }
          },
          required: ['summary', 'comments']
        }
      }
    ]
  })

  let fallbackResult = ''
  let hasJsonFallback = false

  // Extract response from tool use
  // Find content blocks that are tool_use type
  for (const content of message.content) {
    if (content.type === 'tool_use') {
      if (content.name === 'provide_code_review' && content.input) {
        // Return the structured response as a JSON string
        return JSON.stringify(content.input as CodeReviewResponse)
      } else {
        console.error('Unexpected tool use response:', {
          name: content.name,
          input: content.input
        })
        throw new Error(`Unexpected tool name: ${content.name}`)
      }
    } else if (content.type === 'text') {
      // Fallback if tool use failed or returned unexpected format
      console.warn(
        'Tool use failed, attempting fallback parsing from text response'
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
            JSON.parse(trimmedText)
            console.log('Response appears to be JSON, using as fallback')
            fallbackResult = trimmedText
            hasJsonFallback = true
            continue // Don't overwrite with plain text
          } catch (error) {
            console.warn('Text looks like JSON but failed to parse:', error)
            // Continue to check for plain text fallback
          }
        }

        // Only use plain text as fallback if we haven't found JSON
        if (!hasJsonFallback) {
          console.warn('No JSON found, using plain text as fallback')
          fallbackResult = text
        }
      } catch (error) {
        console.error('Error processing fallback text:', error)
        // Continue to next content block
      }
    }
  }

  if (fallbackResult) {
    // If we have a fallback result, return it
    console.log('Returning fallback result, hasJsonFallback:', hasJsonFallback)
    return fallbackResult
  }

  throw new Error(
    'Unexpected response format from Anthropic - no content found'
  )
}
