import OpenAI from 'openai'

/**
 * Line comments OpenAI sender.
 * Mirrors Anthropic behavior using OpenAI function/tool calling to enforce a structured JSON response.
 *
 * - Uses official OpenAI endpoint via the official SDK
 * - Enforces the same tool schema: provide_code_review(summary, comments[], search_replace_blocks[])
 * - Maps thinkingEnabled to temperature and instructions (no chain-of-thought logging)
 *
 * Required env:
 *   - OPENAI_API_KEY
 * Optional env:
 *   - OPENAI_MODEL (defaults to "gpt-5")
 */
export async function openaiLineCommentsSender(
  prompt: string,
  enableThinking: boolean = false
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required when llmProvider=openai')
  }

  const client = new OpenAI({ apiKey })

  const model = process.env.OPENAI_MODEL || 'gpt-5'
  // Map "thinking" to higher temperature and instructions. Do not request chain-of-thought.
  const temperature = enableThinking ? 1 : 0

  // Shared JSON schema for parity with Anthropic sender
  const reviewTool = {
    type: 'function' as const,
    function: {
      name: 'provide_code_review',
      description: 'Provide structured code review with line-specific comments',
      parameters: {
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
        required: ['summary']
      }
    }
  }

  // System guidance to keep parity and avoid chain-of-thought leakage
  const systemInstruction =
    'You are an expert code reviewer. When appropriate, use the tool `provide_code_review` to return a structured JSON result. Do not include your internal reasoning or chain-of-thought in outputs. If you need to reason, do so silently and only output the structured result.'

  const completion = await client.chat.completions.create({
    model,
    temperature,
    tool_choice: 'auto',
    tools: [reviewTool],
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: prompt }
    ]
  })

  const choice = completion.choices?.[0]
  if (!choice) {
    throw new Error('OpenAI API returned no choices')
  }

  // Prefer function/tool call result for strict structure
  const toolCalls = choice.message?.tool_calls
  if (toolCalls && toolCalls.length > 0) {
    const first = toolCalls[0] as unknown
    // Support both standard function tool calls and any custom tool call types
    // that may not declare the "function" property in the type definition.
    // We guard at runtime and cast to avoid TS union issues.
    if (first && typeof (first as any).function?.arguments === 'string') {
      const args = (first as any).function.arguments
      if (!args) {
        throw new Error('OpenAI tool call is missing arguments')
      }
      // Validate JSON is parseable; return as string to match Anthropic sender contract
      try {
        JSON.parse(args)
      } catch (e) {
        throw new Error(
          `OpenAI tool call returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      return args
    }
  }

  // Fallback: attempt to parse JSON from assistant message content
  const content = choice.message?.content ?? ''
  const parsed = tryExtractJson(content)
  if (parsed) {
    return JSON.stringify(parsed)
  }

  throw new Error(
    'Unexpected response format from OpenAI inline comment - no tool calls or JSON content found'
  )
}

function tryExtractJson(text: string): unknown | null {
  // Try fenced JSON code block ```json ... ```
  const block = /```json\s*([\s\S]*?)```/i.exec(text)
  if (block?.[1]) {
    const candidate = block[1].trim()
    try {
      return JSON.parse(candidate)
    } catch {
      // continue
    }
  }

  // Try to parse entire content as JSON
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // continue
    }
  }

  return null
}
