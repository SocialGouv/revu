import OpenAI from 'openai'
import type {
  DiscussionPromptSegments,
  TextPart
} from '../../../prompt-strategies/build-discussion-prompt-segments.ts'
import { computeSegmentsPrefixHash } from '../../../utils/prompt-prefix.ts'
import { logSystemWarning } from '../../../utils/logger.ts'
const MAX_OPENAI_PROMPT_CHARS =
  Number(process.env.MAX_OPENAI_PROMPT_CHARS) || 120_000

export async function discussionSender(
  promptOrSegments: string | DiscussionPromptSegments,
  enableThinking: boolean = false
): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const hasSegments = Array.isArray((promptOrSegments as any)?.stableParts)
  const model = process.env.OPENAI_MODEL || 'gpt-5'
  // For discussions, allow enough budget for both reasoning and answer,
  // but keep reasoning effort lower when thinking is disabled.
  const maxOutputTokens = enableThinking ? 2048 : 1024

  function extractText(value: unknown): string {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      return value.map((v) => extractText(v)).join('')
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>

      // Prefer common text-bearing fields
      if (obj.text !== undefined) {
        const t = extractText(obj.text)
        if (t) return t
      }
      if (obj.content !== undefined) {
        const c = extractText(obj.content)
        if (c) return c
      }

      // Fallback: scan all values
      return Object.values(obj)
        .map((v) => extractText(v))
        .join('')
    }
    return ''
  }

  function normalizeContent(raw: unknown): string {
    return extractText(raw)
  }

  let prefixHash: string | undefined
  // Normalize to a single user message string (deterministic join)
  const rawContent = hasSegments
    ? [
        ...(
          (promptOrSegments as DiscussionPromptSegments)
            .stableParts as TextPart[]
        ).map((p) => p.text),
        ...(
          (promptOrSegments as DiscussionPromptSegments)
            .dynamicParts as TextPart[]
        ).map((p) => p.text)
      ].join('\n')
    : String(promptOrSegments)

  const content =
    rawContent.length > MAX_OPENAI_PROMPT_CHARS
      ? `${rawContent.slice(0, MAX_OPENAI_PROMPT_CHARS)}\n... (truncated)`
      : rawContent

  if (hasSegments) {
    prefixHash = computeSegmentsPrefixHash(
      promptOrSegments as DiscussionPromptSegments,
      model
    )
  }

  async function callOnce(
    inputContent: string,
    options?: {
      maxTokens?: number
      reasoningEffort?: 'low' | 'medium' | 'high'
    }
  ) {
    const response = await client.responses.create({
      model,
      input: [{ role: 'user', content: inputContent }],
      max_output_tokens: options?.maxTokens ?? maxOutputTokens,
      reasoning: {
        effort: options?.reasoningEffort ?? (enableThinking ? 'medium' : 'low')
      },
      text: {
        format: { type: 'text' },
        verbosity: 'low'
      }
    } as any)

    const rawFromHelper = (response as any).output_text
    const raw = rawFromHelper ?? (response as any).output ?? ''
    const text = normalizeContent(raw)
    const trimmed = text.trim()

    if (
      process.env.PROMPT_CACHE_DEBUG === 'true' &&
      hasSegments &&
      prefixHash
    ) {
      const usage = (response as any)?.usage ?? {}
      const metrics = {
        prefix_hash: prefixHash,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      }
      logSystemWarning('OpenAI discussion cache context', {
        context_msg: JSON.stringify(metrics)
      })
    }

    return { text, trimmed, response }
  }

  // First attempt
  const first = await callOnce(content)
  if (first.trimmed.length > 0) {
    return first.trimmed
  }

  // If we exhausted the budget on hidden reasoning (no visible text),
  // try a smaller, focused follow-up with low reasoning effort.
  const status = (first.response as any).status
  const incompleteReason = (first.response as any).incomplete_details?.reason

  if (status === 'incomplete' && incompleteReason === 'max_output_tokens') {
    const followupContent =
      content +
      '\n\nAssistant note: In one or two short sentences, directly answer the latest user reply. Do NOT leave this blank, and do not spend time on extended reasoning.'

    const followup = await callOnce(followupContent, {
      maxTokens: 256,
      reasoningEffort: 'low'
    })

    if (followup.trimmed.length > 0) {
      return followup.trimmed
    }
  }

  // Still no usable text; let the discussion handler decide whether to
  // fall back to a generic message based on the empty reply.
  return ''
}
