import OpenAI from 'openai'
import { REVIEW_TOOL_NAME } from '../../shared/review-tool-schema.ts'
import { prepareLineCommentsPayload } from '../../shared/line-comments-common.ts'

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
  // Prepare shared payload parts (tools, messages, temperature)
  // Pass model to enable model-specific parameter handling (e.g., GPT-5 requires temperature=1)
  const prepared = prepareLineCommentsPayload(
    'openai',
    prompt,
    enableThinking,
    model
  )

  // System guidance and user prompt via shared builder

  const completion = await client.chat.completions.create({
    model,
    temperature: prepared.temperature,
    tools: prepared.tools,
    tool_choice: {
      type: 'function',
      function: { name: REVIEW_TOOL_NAME }
    },
    messages: prepared.messages
  })

  const choice = completion.choices?.[0]
  if (!choice) {
    throw new Error('OpenAI API returned no choices')
  }

  const toolCalls = choice.message?.tool_calls
  if (!toolCalls || toolCalls.length === 0) {
    throw new Error(
      `OpenAI did not call required tool ${REVIEW_TOOL_NAME} in inline comment response`
    )
  }

  const first = toolCalls[0] as any

  // Support both standard function tool calls and any custom tool call types
  // that may not declare the "function" property in the type definition.
  // We guard at runtime and cast to avoid TS union issues.
  const fn = first.function
  if (!fn || typeof fn.arguments !== 'string') {
    throw new Error(
      `OpenAI tool call ${REVIEW_TOOL_NAME} is missing function arguments`
    )
  }

  const args = fn.arguments
  if (!args) {
    throw new Error('OpenAI tool call is missing arguments')
  }

  // Validate JSON is parseable; return as string to match Anthropic sender contract
  try {
    JSON.parse(args)
  } catch (e) {
    throw new Error(
      `OpenAI tool call returned invalid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
  }

  return args
}
