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
  const maxCompletionTokens = enableThinking ? 2048 : 1024

  function normalizeContent(raw: unknown): string {
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw)) {
      return raw
        .map((part: any) => {
          if (typeof part === 'string') return part
          if (part && typeof part.text === 'string') return part.text
          if (part && typeof part.content === 'string') return part.content
          return ''
        })
        .join('')
    }
    return ''
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

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    // gpt-5 and similar models use max_completion_tokens and may reject temperature
    max_completion_tokens: maxCompletionTokens
  } as any)

  const raw = completion.choices?.[0]?.message?.content
  const text = normalizeContent(raw)
  const trimmed = text.trim()

  if (process.env.DISCUSSION_LLM_DEBUG === 'true') {
    const preview = text.slice(0, 300)
    const length = text.length
    logSystemWarning('OpenAI discussion raw reply', {
      context_msg: 'Raw OpenAI discussion completion',
      repository: process.env.GITHUB_REPOSITORY,
      pr_number: undefined,
      provider: 'openai',
      model,
      raw_reply_preview: preview,
      raw_reply_length: length
    })
  }

  if (process.env.PROMPT_CACHE_DEBUG === 'true' && hasSegments && prefixHash) {
    const usage = (completion as any)?.usage ?? {}
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
