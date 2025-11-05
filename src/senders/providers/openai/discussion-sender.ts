import OpenAI from 'openai'
import type {
  DiscussionPromptSegments,
  TextPart
} from '../../../prompt-strategies/build-discussion-prompt-segments.ts'

export async function discussionSender(
  promptOrSegments: string | DiscussionPromptSegments,
  enableThinking: boolean = false
): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // Normalize to a single user message string (deterministic join)
  const content = Array.isArray((promptOrSegments as any)?.stableParts)
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

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    temperature: 0,
    max_tokens: enableThinking ? 2048 : 1024
  })

  const text = completion.choices?.[0]?.message?.content
  return typeof text === 'string' ? text : JSON.stringify(completion)
}
