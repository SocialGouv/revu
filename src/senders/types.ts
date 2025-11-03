export type LLMSender = (prompt: string) => Promise<string>

export type DiscussionSender = (
  promptOrSegments:
    | string
    | import('../prompt-strategies/build-discussion-prompt-segments.ts').DiscussionPromptSegments
) => Promise<string>
