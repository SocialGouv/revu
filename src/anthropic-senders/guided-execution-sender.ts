import Anthropic from '@anthropic-ai/sdk'
import { processAnthropicResponse } from './response-processor.ts'

// Type for code review response (same as line-comments-sender)
interface CodeReviewResponse {
  summary: string
  comments: Array<{
    path: string
    line: number
    start_line?: number
    body: string
    search_replace_blocks?: Array<{
      search: string
      replace: string
    }>
  }>
}

/**
 * Guided Execution Anthropic sender.
 * This sender uses Anthropic's Tool Use / Function Calling capability
 * to enforce a structured JSON response with specific line-based comments.
 * It's enhanced with review planning context to generate more targeted reviews.
 *
 * @param prompt - The guided execution prompt to send to Anthropic (includes review plan)
 * @returns A stringified JSON response containing structured review comments
 */
export async function guidedExecutionSender(prompt: string): Promise<string> {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Send to Anthropic API with tool use configuration
  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0, // Keep deterministic for execution phase
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
          'Provide structured code review with line-specific comments guided by a review plan',
        input_schema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description:
                'Overall summary of the PR focusing on priorities identified in the planning phase'
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
                    description:
                      'Detailed comment about the issue, prioritizing areas identified in the review plan'
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
              },
              description:
                'Array of line-specific comments focused on priorities'
            }
          },
          required: ['summary', 'comments']
        }
      }
    ]
  })

  // Use shared response processor with basic validation
  return processAnthropicResponse<CodeReviewResponse>(message, {
    expectedToolName: 'provide_code_review',
    contextName: 'Guided execution'
  })
}
