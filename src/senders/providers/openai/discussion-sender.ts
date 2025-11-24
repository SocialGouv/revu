import OpenAI from 'openai'
import type {
  DiscussionPromptSegments,
  TextPart
} from '../../../prompt-strategies/build-discussion-prompt-segments.ts'
import { computeSegmentsPrefixHash } from '../../../utils/prompt-prefix.ts'
import { logSystemWarning } from '../../../utils/logger.ts'
import { getRuntimeConfig } from '../../../core/utils/runtime-config.ts'

export async function discussionSender(
  promptOrSegments: string | DiscussionPromptSegments,
  enableThinking: boolean = false
): Promise<string> {
  const runtime = await getRuntimeConfig()
  const client = new OpenAI({ apiKey: runtime.llm.openai.apiKey })

  const hasSegments = Array.isArray((promptOrSegments as any)?.stableParts)
  const model = runtime.llm.openai.model

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
  const maxChars = runtime.llm.openai.maxPromptChars
  const content =
    rawContent.length > maxChars
      ? `${rawContent.slice(0, maxChars)}\n... (truncated)`
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
    temperature: 0,
    max_tokens: enableThinking ? 2048 : 1024
  })

  if (runtime.discussion.promptCache.debug && hasSegments && prefixHash) {
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
  return typeof text === 'string' ? text : JSON.stringify(completion)
}
