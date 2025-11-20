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
  // For discussions, keep completions relatively short to discourage
  // spending everything on hidden reasoning without emitting text.
  const maxCompletionTokens = enableThinking ? 1024 : 512

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

  const response = await client.responses.create({
    model,
    // Preserve prior "messages"-style semantics by sending an array
    // that the Responses API accepts as input when migrating from Chat.
    input: [{ role: 'user', content }],
    max_output_tokens: maxCompletionTokens
  } as any)

  // Prefer the SDK helper when available, but fall back to the raw
  // output structure to keep this robust to SDK/version differences.
  const rawFromHelper = (response as any).output_text
  const raw = rawFromHelper ?? (response as any).output ?? ''

  const text = normalizeContent(raw)
  const trimmed = text.trim()

  if (process.env.DISCUSSION_LLM_DEBUG === 'true') {
    const preview = text.slice(0, 300)
    const length = text.length

    let rawDump: string | undefined
    try {
      rawDump = JSON.stringify(raw)
    } catch {
      rawDump = '[unserializable]'
    }
    if (rawDump && rawDump.length > 800) {
      rawDump = rawDump.slice(0, 800) + '... (truncated)'
    }

    let responseDump: string | undefined
    try {
      responseDump = JSON.stringify(response)
    } catch {
      responseDump = '[unserializable]'
    }
    if (responseDump && responseDump.length > 1200) {
      responseDump =
        responseDump.slice(0, 1200) + '... (truncated full response)'
    }

    logSystemWarning('OpenAI discussion raw reply', {
      context_msg: 'Raw OpenAI discussion completion',
      repository: process.env.GITHUB_REPOSITORY,
      pr_number: undefined,
      provider: 'openai',
      model,
      raw_reply_preview: preview,
      raw_reply_length: length,
      raw_type: typeof raw,
      raw_is_array: Array.isArray(raw),
      raw_dump: rawDump,
      completion_dump: responseDump
    })
  }

  if (process.env.PROMPT_CACHE_DEBUG === 'true' && hasSegments && prefixHash) {
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

  return trimmed
}
