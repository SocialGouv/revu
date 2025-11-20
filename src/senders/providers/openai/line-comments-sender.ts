import OpenAI from 'openai'
import { REVIEW_PARAMETERS_SCHEMA } from '../../shared/review-tool-schema.ts'
import { getOpenAITemperature } from '../../shared/line-comments-common.ts'
import { computePromptHash } from '../../../utils/prompt-prefix.ts'
import { logSystemWarning } from '../../../utils/logger.ts'

/**
 * Line comments OpenAI sender.
 * Uses OpenAI Responses API with Structured Outputs (json_schema) to enforce
 * a structured JSON response matching REVIEW_PARAMETERS_SCHEMA.
 *
 * - Uses official OpenAI endpoint via the official SDK
 * - Returns the raw JSON string matching the shared schema
 * - Maps thinkingEnabled to temperature (no chain-of-thought logging)
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
  const temperature = getOpenAITemperature(model, enableThinking)

  const promptHash = computePromptHash(prompt, model)

  const response = await client.responses.create({
    model,
    input: prompt,
    temperature,
    text: {
      format: {
        type: 'json_schema',
        name: 'code_review',
        strict: true,
        schema: REVIEW_PARAMETERS_SCHEMA
      }
    }
  })

  if (process.env.PROMPT_CACHE_DEBUG === 'true') {
    const usage = (response as any)?.usage ?? {}
    const metrics = {
      prompt_hash: promptHash,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens
    }
    logSystemWarning('OpenAI line-comments cache context', {
      context_msg: JSON.stringify(metrics)
    })
  }

  const raw = (response as any).output_text
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      'OpenAI Responses API did not return output_text for line comments'
    )
  }

  // Validate JSON is parseable; return as string to match Anthropic sender contract
  try {
    JSON.parse(raw)
  } catch (e) {
    throw new Error(
      `OpenAI Responses API returned invalid JSON for line comments: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
  }

  return raw
}
