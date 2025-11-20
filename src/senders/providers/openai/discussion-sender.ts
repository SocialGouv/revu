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

  async function callOnce(
    payload: string | DiscussionPromptSegments,
    attempt: 'first' | 'second'
  ): Promise<string> {
    const isSegments = Array.isArray((payload as any)?.stableParts)

    let prefixHash: string | undefined
    // Normalize to a single user message string (deterministic join)
    const rawContent = isSegments
      ? [
          ...(
            (payload as DiscussionPromptSegments).stableParts as TextPart[]
          ).map((p) => p.text),
          ...(
            (payload as DiscussionPromptSegments).dynamicParts as TextPart[]
          ).map((p) => p.text)
        ].join('\n')
      : String(payload)

    const content =
      rawContent.length > MAX_OPENAI_PROMPT_CHARS
        ? `${rawContent.slice(0, MAX_OPENAI_PROMPT_CHARS)}\n... (truncated)`
        : rawContent

    if (isSegments) {
      prefixHash = computeSegmentsPrefixHash(
        payload as DiscussionPromptSegments,
        model
      )
    }

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content }],
      // gpt-5 and similar models use max_completion_tokens and may reject temperature
      max_completion_tokens: maxCompletionTokens
    } as any)

    if (process.env.DISCUSSION_LLM_DEBUG === 'true') {
      const raw = completion.choices?.[0]?.message?.content
      const preview = typeof raw === 'string' ? raw.slice(0, 300) : ''
      const length = typeof raw === 'string' ? raw.length : 0
      logSystemWarning('OpenAI discussion raw reply', {
        context_msg:
          attempt === 'first'
            ? 'Raw OpenAI discussion completion (first attempt)'
            : 'Raw OpenAI discussion completion (second attempt after empty reply)',
        repository: process.env.GITHUB_REPOSITORY,
        pr_number: undefined,
        provider: 'openai',
        model,
        raw_reply_preview: preview,
        raw_reply_length: length
      })
    }

    if (process.env.PROMPT_CACHE_DEBUG === 'true' && isSegments && prefixHash) {
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

    const text = completion.choices?.[0]?.message?.content
    return typeof text === 'string' ? text : ''
  }

  // First attempt
  const firstReply = (await callOnce(promptOrSegments, 'first')).trim()
  if (firstReply.length > 0) {
    return firstReply
  }

  // Second attempt with explicit guidance to avoid empty replies
  let secondPayload: string | DiscussionPromptSegments
  if (hasSegments) {
    const segments = promptOrSegments as DiscussionPromptSegments
    secondPayload = {
      ...segments,
      dynamicParts: [
        ...(segments.dynamicParts as TextPart[]),
        {
          type: 'text',
          text: 'Your previous attempt produced an empty reply. Now provide at least one concise sentence that directly answers the latest User Reply. Do NOT leave the response blank.'
        }
      ]
    }
  } else {
    secondPayload = `${String(promptOrSegments)}\n\nAssistant note: Your previous attempt produced an empty reply. Now provide at least one concise sentence directly answering the user.`
  }

  const secondReply = (await callOnce(secondPayload, 'second')).trim()
  return secondReply
}
