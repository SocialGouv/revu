import Anthropic from '@anthropic-ai/sdk'

/**
 * Discussion Anthropic sender.
 * Produces a single, concise assistant reply (plain markdown/text).
 *
 * @param prompt - The prompt to send to Anthropic
 * @param enableThinking - Optional flag to enable extended thinking capabilities
 * @returns Assistant reply text
 */
import type {
  DiscussionPromptSegments,
  TextPart
} from '../../../prompt-strategies/build-discussion-prompt-segments.ts'
import { computeSegmentsPrefixHash } from '../../../utils/prompt-prefix.ts'
import { logSystemWarning } from '../../../utils/logger.ts'

export async function discussionSender(
  promptOrSegments: string | DiscussionPromptSegments,
  enableThinking: boolean = false
): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  const thinkingConfig = enableThinking
    ? {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: 4000
        }
      }
    : {}

  const maxTokens = enableThinking ? 4096 : 1024
  const useExtendedContext = process.env.ANTHROPIC_EXTENDED_CONTEXT !== 'false'

  // Build content blocks: if string, single text block; if segments, stitch stable+dynamic
  const isSegments = Array.isArray((promptOrSegments as any)?.stableParts)
  const enablePromptCache =
    (process.env.ENABLE_PROMPT_CACHE || 'true') !== 'false'
  const ttlSeconds = (() => {
    const v = Number(process.env.PROMPT_CACHE_TTL)
    return Number.isFinite(v) && v > 0 ? v : 172_800
  })()

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'

  let prefixHash: string | undefined
  if (isSegments) {
    prefixHash = computeSegmentsPrefixHash(
      promptOrSegments as DiscussionPromptSegments,
      model
    )
  }

  const contentBlocks: Array<any> = isSegments
    ? [
        // Stable parts: optionally add provider cache hints (best-effort)
        ...(
          (promptOrSegments as DiscussionPromptSegments)
            .stableParts as TextPart[]
        ).map((p) =>
          enablePromptCache
            ? ({
                type: 'text' as const,
                text: p.text,
                // Anthropic prompt-caching hint (SDK may not type it yet)
                cache_control: { type: 'ephemeral', ttl: ttlSeconds } as any
              } as any)
            : ({ type: 'text' as const, text: p.text } as any)
        ),
        // Dynamic parts: never cache
        ...(
          (promptOrSegments as DiscussionPromptSegments)
            .dynamicParts as TextPart[]
        ).map((p) => ({
          type: 'text' as const,
          text: p.text
        }))
      ]
    : [{ type: 'text' as const, text: String(promptOrSegments) }]

  const messageParams = {
    model,
    max_tokens: maxTokens,
    // For deterministic replies in threaded discussions, always use temperature 0
    temperature: 0,
    ...thinkingConfig,
    messages: [
      {
        role: 'user' as const,
        content: contentBlocks
      }
    ],
    ...(useExtendedContext ? { betas: ['context-1m-2025-08-07'] } : {})
  }

  try {
    const message = useExtendedContext
      ? await anthropic.beta.messages.create(messageParams)
      : await anthropic.messages.create(messageParams)

    if (process.env.DISCUSSION_LLM_DEBUG === 'true') {
      const content = (message as any)?.content
      let textPreview = ''
      let textLength = 0
      if (Array.isArray(content)) {
        const textBlock = content.find((c: any) => c?.type === 'text')
        if (textBlock?.text && typeof textBlock.text === 'string') {
          textPreview = textBlock.text.slice(0, 300)
          textLength = textBlock.text.length
        }
      } else if (typeof (message as any)?.content === 'string') {
        textPreview = String((message as any).content).slice(0, 300)
        textLength = String((message as any).content).length
      }

      logSystemWarning('Anthropic discussion raw reply', {
        context_msg: 'Raw Anthropic discussion completion',
        repository: process.env.GITHUB_REPOSITORY,
        provider: 'anthropic',
        model,
        raw_reply_preview: textPreview,
        raw_reply_length: textLength
      })
    }

    const usage = (message as any)?.usage ?? {}
    if (process.env.PROMPT_CACHE_DEBUG === 'true' && isSegments && prefixHash) {
      const metrics = {
        prefix_hash: prefixHash,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens
      }
      logSystemWarning('Anthropic discussion cache usage', {
        context_msg: JSON.stringify(metrics)
      })
    }

    // Extract first text block
    const content = (message as any)?.content
    if (Array.isArray(content)) {
      const textBlock = content.find((c: any) => c?.type === 'text')
      if (textBlock?.text && typeof textBlock.text === 'string') {
        return textBlock.text
      }
    }
    // Fallback to stringifying if unexpected shape
    return typeof (message as any)?.content === 'string'
      ? ((message as any).content as string)
      : JSON.stringify(message)
  } catch (error) {
    const apiType = useExtendedContext ? 'beta (extended context)' : 'standard'
    throw new Error(
      `Failed to create message using Anthropic ${apiType} API: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
