/**
 * Shared constants and JSON schema for the structured code review tool/function.
 * Used by both Anthropic and OpenAI senders to keep parity and avoid duplication.
 *
 * Note: For OpenAI Structured Outputs (Responses API), all objects in this schema
 * must set `additionalProperties: false` to be accepted.
 */

export const REVIEW_TOOL_NAME = 'provide_code_review' as const

export const REVIEW_TOOL_DESCRIPTION =
  'Provide structured code review with line-specific comments' as const

/**
 * JSON Schema for the structured review payload.
 * This schema is compatible with:
 * - Anthropic tools: input_schema
 * - OpenAI function/tool calling: parameters
 */
export const REVIEW_PARAMETERS_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: {
      type: 'string' as const,
      description:
        'Overall summary of the PR. Supports GitHub-flavored Markdown (headings, lists, tables, code fences).'
    },
    comments: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string' as const,
            description: 'File path relative to repository root'
          },
          line: {
            type: 'integer' as const,
            description:
              'End line number for the comment (or single line if start_line not provided)'
          },
          start_line: {
            type: ['integer', 'null'] as const,
            description:
              'Start line number for multi-line comments. Use null when not applicable. Must be <= line when provided.'
          },
          body: {
            type: 'string' as const,
            description:
              'Detailed comment about the issue. Supports GitHub-flavored Markdown (headings, lists, tables, code fences, suggestion blocks).'
          },
          search_replace_blocks: {
            type: ['array', 'null'] as const,
            items: {
              type: 'object' as const,
              properties: {
                search: {
                  type: 'string' as const,
                  description:
                    'Exact code content to find. Must match character-for-character including whitespace, indentation, and line endings.'
                },
                replace: {
                  type: 'string' as const,
                  description:
                    'New code content to replace the search content with.'
                }
              },
              required: ['search', 'replace'],
              additionalProperties: false as const
            },
            description:
              'SEARCH/REPLACE blocks for precise code modifications. Each search block must match existing code exactly. Use null when no changes are suggested.'
          }
        },
        required: [
          'path',
          'line',
          'start_line',
          'body',
          'search_replace_blocks'
        ],
        additionalProperties: false as const
      }
    }
  },
  required: ['summary', 'comments'],
  additionalProperties: false as const
}

/**
 * System instruction used by the OpenAI sender to avoid chain-of-thought in outputs
 * while instructing to return structured results via the tool.
 */
export const REVIEW_SYSTEM_INSTRUCTION =
  'You are an expert code reviewer. When appropriate, use the tool `provide_code_review` to return a structured JSON result. Do not include your internal reasoning or chain-of-thought in outputs. If you need to reason, do so silently and only output the structured result.' as const
