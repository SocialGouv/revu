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
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
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

  // Extract response from tool use
  // Find content blocks that are tool_use type
  for (const content of message.content) {
    if (content.type === 'tool_use') {
      if (content.name === 'provide_code_review' && content.input) {
        // Return the structured response as a JSON string
        return JSON.stringify(content.input as CodeReviewResponse)
      } else {
        console.log('Input:', content.input)
        console.log('Tool name:', content.name)
        throw new Error('Tool name or input incorect')
      }
    } else {
      // Fallback if tool use failed or returned unexpected format
      if (content.type === 'text') {
        // Try to parse any JSON that might be in the response
        try {
          const text = content.text
          // const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
          const jsonMatch = text.match(/```json\n([\s\S]{1,10000}?)\n```/)
          if (jsonMatch && jsonMatch[1]) {
            fallbackResult = jsonMatch[1].trim()
          }
          // If the whole response is potentially JSON
          if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
            fallbackResult = text
          }

          // Just return the text as is
          fallbackResult = text
        } catch {
          // Silent catch - continue to next content block or error
        }
      }
    }
  }

  if (fallbackResult) {
    // If we have a fallback result, return it
    return fallbackResult
  }
  throw new Error('Unexpected response format from Anthropic')
}
