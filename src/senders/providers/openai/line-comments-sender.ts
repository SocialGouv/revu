import OpenAI from 'openai'
import { REVIEW_PARAMETERS_SCHEMA } from '../../shared/review-tool-schema.ts'
import { getOpenAITemperature } from '../../shared/line-comments-common.ts'
import { computePromptHash } from '../../../utils/prompt-prefix.ts'
import { logSystemWarning } from '../../../utils/logger.ts'
import { getRuntimeConfig } from '../../../core/utils/runtime-config.ts'

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
  const runtime = await getRuntimeConfig()
  const apiKey = runtime.llm.openai.apiKey
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required when llmProvider=openai')
  }

  const client = new OpenAI({ apiKey })


  const model = runtime.llm.openai.model
  // Prepare shared payload parts (tools, messages, temperature)
  // Pass model to enable model-specific parameter handling (e.g., GPT-5 requires temperature=1)
  const prepared = prepareLineCommentsPayload(
    'openai',
    prompt,
    enableThinking,
    model
  )

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

  if (runtime.discussion.promptCache.debug) {
    const usage = (completion as any)?.usage ?? {}
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
