import { getAppConfig } from '../core/utils/config-loader.ts'
import { anthropicLineCommentsSender } from './providers/anthropic/line-comments-sender.ts'
import { openaiLineCommentsSender } from './providers/openai/line-comments-sender.ts'
import type { LLMSender } from './types.ts'

export async function getSender(_strategyName?: string): Promise<LLMSender> {
  const config = await getAppConfig()
  const enableThinking = config.thinkingEnabled || false
  const provider = config.llmProvider || 'anthropic'

  if (provider === 'openai') {
    return (prompt: string) => openaiLineCommentsSender(prompt, enableThinking)
  }

  return (prompt: string) => anthropicLineCommentsSender(prompt, enableThinking)
}

export type { LLMSender } from './types.ts'
