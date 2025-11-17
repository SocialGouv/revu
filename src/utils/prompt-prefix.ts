import { simpleHash } from './compute-cache.ts'
import type { DiscussionPromptSegments } from '../prompt-strategies/build-discussion-prompt-segments.ts'

/**
 * Deterministically compute a short hash for the stable prefix of a
 * DiscussionPromptSegments structure. This is intended for observability
 * of provider-side prompt caching (KV cache reuse).
 */
export function computeSegmentsPrefixHash(
  segments: DiscussionPromptSegments,
  model?: string,
  hashLength: 8 | 16 = 16
): string {
  const stableTexts = (segments.stableParts || []).map((p) => p.text ?? '')

  // Use a fixed separator so that concatenation is fully deterministic.
  const serializedPrefix = stableTexts.join('\n---SEG---\n')
  const payload = model
    ? `${serializedPrefix}\n\nmodel:${model}`
    : serializedPrefix

  return simpleHash(payload, hashLength)
}

/**
 * Compute a short hash for an arbitrary prompt string (e.g. line-comments
 * full review prompt), optionally including the model name. This is mainly
 * for logging and correlation; it is not a security primitive.
 */
export function computePromptHash(
  prompt: string,
  model?: string,
  hashLength: 8 | 16 = 16
): string {
  const payload = model ? `${prompt}\n\nmodel:${model}` : prompt
  return simpleHash(payload, hashLength)
}
