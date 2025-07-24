import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicResponseProcessor } from './response-processor/processor.ts'

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
                  search_replace_blocks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        search: {
                          type: 'string',
                          description:
                            'Exact code content to find. Must match character-for-character including whitespace, indentation, and line endings.'
                        },
                        replace: {
                          type: 'string',
                          description:
                            'New code content to replace the search content with.'
                        }
                      },
                      required: ['search', 'replace']
                    },
                    description:
                      'SEARCH/REPLACE blocks for precise code modifications. Each search block must match existing code exactly.'
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

  // Use shared response processor with basic validation
  const processResponse = createAnthropicResponseProcessor({
    expectedToolName: 'provide_code_review',
    contextName: 'Inline comment'
  })
  return processResponse(message)
}
