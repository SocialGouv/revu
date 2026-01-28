/**
 * Utilities for manipulating GitHub-flavored Markdown.
 *
 * Current focus: de-duplicating repeated ```suggestion fenced blocks.
 */

type SuggestionBlock = {
  raw: string
  content: string
  index: number
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, '\n')
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === '') start++
  while (end > start && lines[end - 1]?.trim() === '') end--
  return lines.slice(start, end)
}

/**
 * Normalization used for determining equivalence of suggestion blocks.
 * We intentionally preserve indentation (it matters in many languages),
 * but we ignore:
 * - CRLF vs LF
 * - trailing whitespace per line
 * - leading/trailing blank lines
 */
export function normalizeSuggestionContent(content: string): string {
  const normalized = normalizeNewlines(content)
  const lines = normalized.split('\n').map((l) => l.replace(/[\t ]+$/g, ''))
  return trimBlankEdges(lines).join('\n')
}

/**
 * Extracts fenced ```suggestion blocks from markdown.
 *
 * This is a best-effort parser; it assumes typical GitHub fences:
 *
 * ```suggestion
 * ...
 * ```
 */
export function extractSuggestionBlocks(markdown: string): SuggestionBlock[] {
  const text = normalizeNewlines(markdown)
  // Match fenced code blocks with info string exactly "suggestion" (allow trailing spaces).
  // Non-greedy capture until the next closing fence.
  const re = /```suggestion[ \t]*\n([\s\S]*?)\n```/g
  const blocks: SuggestionBlock[] = []
  for (const match of text.matchAll(re)) {
    if (match.index == null) continue
    const raw = match[0]
    const content = match[1] ?? ''
    blocks.push({ raw, content, index: match.index })
  }
  return blocks
}

export function containsEquivalentSuggestionBlock(
  markdown: string,
  suggestionBlock: string
): boolean {
  const existing = extractSuggestionBlocks(markdown)
  const targetBlocks = extractSuggestionBlocks(suggestionBlock)
  const targetContent = normalizeSuggestionContent(
    targetBlocks[0]?.content ?? ''
  )
  if (!targetContent) return false

  return existing.some(
    (b) => normalizeSuggestionContent(b.content) === targetContent
  )
}

/**
 * Removes repeated ```suggestion blocks (equivalence is whitespace-insensitive as described in
 * normalizeSuggestionContent). Keeps the first occurrence and preserves relative order of other
 * content.
 */
export function dedupeSuggestionBlocks(markdown: string): {
  markdown: string
  removed: number
} {
  const text = normalizeNewlines(markdown)
  const re = /```suggestion[ \t]*\n([\s\S]*?)\n```/g
  const matches = Array.from(text.matchAll(re))
  if (matches.length <= 1) return { markdown: text, removed: 0 }

  const seen = new Set<string>()
  let removed = 0
  let out = ''
  let lastIndex = 0

  for (const m of matches) {
    if (m.index == null) continue
    const raw = m[0]
    const content = m[1] ?? ''
    const key = normalizeSuggestionContent(content)

    out += text.slice(lastIndex, m.index)
    if (key && !seen.has(key)) {
      seen.add(key)
      out += raw
    } else {
      removed++
      // Drop the whole block; keep surrounding prose.
    }
    lastIndex = m.index + raw.length
  }
  out += text.slice(lastIndex)

  // Collapse excessive blank lines introduced by removals.
  out = out.replace(/\n{3,}/g, '\n\n')

  return { markdown: out, removed }
}
