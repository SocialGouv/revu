import type Anthropic from '@anthropic-ai/sdk'
import type { ResponseExtractor } from './types.ts'

/**
 * Creates a tool use extractor for structured responses
 */
export function createToolUseExtractor(
  expectedToolName: string
): ResponseExtractor {
  return {
    name: 'ToolUse',
    canHandle: (content: Anthropic.Messages.ContentBlock): boolean => {
      return content.type === 'tool_use'
    },
    extract: (content: Anthropic.Messages.ContentBlock): string | null => {
      if (content.type !== 'tool_use') {
        return null
      }

      if (content.name === expectedToolName && content.input) {
        return JSON.stringify(content.input)
      }

      throw new Error(`Unexpected tool name: ${content.name}`)
    }
  }
}

/**
 * Creates a JSON code block extractor
 */
export function createJsonCodeBlockExtractor(): ResponseExtractor {
  return {
    name: 'JsonCodeBlock',
    canHandle: (content: Anthropic.Messages.ContentBlock): boolean => {
      if (content.type !== 'text') return false
      return /```json\n([\s\S]{1,10000}?)\n```/.test(content.text)
    },
    extract: (content: Anthropic.Messages.ContentBlock): string | null => {
      if (content.type !== 'text') return null

      const jsonMatch = content.text.match(/```json\n([\s\S]{1,10000}?)\n```/)
      if (jsonMatch && jsonMatch[1]) {
        return jsonMatch[1].trim()
      }

      return null
    }
  }
}

/**
 * Creates a JSON text extractor
 */
export function createJsonTextExtractor(): ResponseExtractor {
  return {
    name: 'JsonText',
    canHandle: (content: Anthropic.Messages.ContentBlock): boolean => {
      if (content.type !== 'text') return false
      const trimmedText = content.text.trim()
      return trimmedText.startsWith('{') && trimmedText.endsWith('}')
    },
    extract: (content: Anthropic.Messages.ContentBlock): string | null => {
      if (content.type !== 'text') return null

      const trimmedText = content.text.trim()
      if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
        return trimmedText
      }

      return null
    }
  }
}

/**
 * Creates a plain text extractor (fallback)
 */
export function createPlainTextExtractor(): ResponseExtractor {
  return {
    name: 'PlainText',
    canHandle: (content: Anthropic.Messages.ContentBlock): boolean => {
      return content.type === 'text'
    },
    extract: (content: Anthropic.Messages.ContentBlock): string | null => {
      if (content.type !== 'text') return null
      return content.text
    }
  }
}
