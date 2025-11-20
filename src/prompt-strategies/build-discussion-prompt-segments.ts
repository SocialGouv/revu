import type { ThreadMessage } from '../comment-handlers/discussion-handler.ts'

export type TextPart = { type: 'text'; text: string }
export type DiscussionPromptSegments = {
  stableParts: TextPart[]
  dynamicParts: TextPart[]
}

// Match existing defaults used by buildPrompt in discussion-handler
const DEFAULT_MAX_CHARS_PER_FILE =
  Number(process.env.MAX_FILE_CONTENT_CHARS) || 50_000
const DEFAULT_MAX_TOTAL_CHARS = 200_000

export function buildDiscussionPromptSegments(input: {
  reviewCtx: {
    prTitle?: string
    prBody?: string
    diff: string
    modifiedFilesContent: Record<string, string>
    codingGuidelines: string
    relatedIssues: Array<{ number: number; title: string }>
    commitSha: string
  }
  parentCommentBody: string
  userReplyBody: string
  history: ThreadMessage[]
  relevantFilePath?: string
  diffHunk?: string
  maxCharsPerFile?: number
  maxTotalChars?: number
}): DiscussionPromptSegments {
  const {
    reviewCtx,
    parentCommentBody,
    userReplyBody,
    history,
    relevantFilePath,
    diffHunk
  } = input

  const MAX_CHARS_PER_FILE = input.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE
  const MAX_TOTAL_CHARS = input.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS

  const issuesList =
    reviewCtx.relatedIssues.length > 0
      ? reviewCtx.relatedIssues
          .map((i) => `- #${i.number} ${i.title}`)
          .join('\n')
      : 'None'

  const prBodyIncluded =
    reviewCtx.prBody && reviewCtx.prBody.trim().length > 0
      ? reviewCtx.prBody
      : '(empty)'

  // Stable: PR meta, guidelines, related issues, diff, files content, parent/root comment
  const stableParts: TextPart[] = []

  stableParts.push({
    type: 'text',
    text: 'You are continuing a code review discussion.'
  })
  stableParts.push({
    type: 'text',
    text: 'Respond concisely (at most ~5 sentences).'
  })
  stableParts.push({
    type: 'text',
    text: 'If proposing a concrete fix, include exactly one GitHub suggestion block using triple-backticks with `suggestion`.'
  })
  stableParts.push({
    type: 'text',
    text: 'If clarification is needed, ask at most one targeted question.'
  })
  stableParts.push({
    type: 'text',
    text: 'Your reply MUST directly move the discussion forward. Do not reply with only acknowledgements, only questions, or by restating the user message.'
  })
  stableParts.push({
    type: 'text',
    text: 'Reply format (plain markdown): 1) One or two sentences that directly answer the latest user reply. 2) Optionally, one short clarification question OR one concrete suggestion block (not both).'
  })
  stableParts.push({
    type: 'text',
    text: 'You must always produce at least one full sentence of explanation; do NOT respond with an empty message, only code, only JSON, or only emojis.'
  })

  stableParts.push({
    type: 'text',
    text: `PR Title: ${reviewCtx.prTitle || '(no title)'}`
  })
  stableParts.push({ type: 'text', text: `PR Body: ${prBodyIncluded}` })

  stableParts.push({ type: 'text', text: 'Coding Guidelines:' })
  stableParts.push({
    type: 'text',
    text: reviewCtx.codingGuidelines || '(none)'
  })

  stableParts.push({ type: 'text', text: 'Related Issues:' })
  stableParts.push({ type: 'text', text: issuesList })

  const MAX_DIFF_CHARS = input.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const diffBody =
    reviewCtx.diff && reviewCtx.diff.length > MAX_DIFF_CHARS
      ? reviewCtx.diff.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)'
      : reviewCtx.diff || '(empty)'

  stableParts.push({
    type: 'text',
    text: 'PR Diff (filtered to reviewable files):'
  })
  stableParts.push({ type: 'text', text: diffBody })

  if (diffHunk) {
    stableParts.push({ type: 'text', text: 'Relevant Diff Hunk:' })
    stableParts.push({ type: 'text', text: diffHunk })
  }

  // Files content section (deterministic ordering and budgets)
  const filesSectionParts: TextPart[] = []
  let totalChars = 0

  if (
    relevantFilePath &&
    reviewCtx.modifiedFilesContent[relevantFilePath] !== undefined
  ) {
    const content = reviewCtx.modifiedFilesContent[relevantFilePath]
    const body =
      content.length > MAX_CHARS_PER_FILE
        ? content.slice(0, MAX_CHARS_PER_FILE) + '\n... (truncated)'
        : content
    totalChars += body.length
    filesSectionParts.push({
      type: 'text',
      text: `--- File: ${relevantFilePath}\n${body}`
    })
  } else {
    const entries = Object.entries(reviewCtx.modifiedFilesContent).sort(
      ([a], [b]) => a.localeCompare(b)
    )
    for (const [file, content] of entries) {
      const remainingBudget = Math.max(0, MAX_TOTAL_CHARS - totalChars)
      const maxForThisFile = Math.min(MAX_CHARS_PER_FILE, remainingBudget)
      const body =
        content.length > maxForThisFile
          ? content.slice(0, maxForThisFile) + '\n... (truncated)'
          : content
      totalChars += body.length
      filesSectionParts.push({
        type: 'text',
        text: `--- File: ${file}\n${body}`
      })
      if (totalChars >= MAX_TOTAL_CHARS) break
    }
  }

  stableParts.push({
    type: 'text',
    text: 'Modified Files Content (possibly truncated):'
  })
  if (filesSectionParts.length === 0) {
    stableParts.push({ type: 'text', text: '(none)' })
  } else {
    // Push each file block separately for finer-grained caching
    stableParts.push(...filesSectionParts)
  }

  stableParts.push({
    type: 'text',
    text: 'Original Revu Comment (root of thread):'
  })
  stableParts.push({ type: 'text', text: sanitize(parentCommentBody) })

  // Dynamic: user reply and history
  const dynamicParts: TextPart[] = []
  dynamicParts.push({ type: 'text', text: 'User Reply (latest message):' })
  dynamicParts.push({ type: 'text', text: sanitize(userReplyBody) })

  const historyText =
    history.length > 0
      ? history.map((h) => `- ${h.author}: ${sanitize(h.body)}`).join('\n')
      : 'None'
  dynamicParts.push({ type: 'text', text: 'Thread History (older to newer):' })
  dynamicParts.push({ type: 'text', text: historyText })

  return { stableParts, dynamicParts }
}

const MAX_SANITIZED_INPUT_CHARS = 4000 // Keep in sync with MAX_REPLY_PROMPT_CHARS in discussion-handler.ts

function sanitize(text: string): string {
  const cleaned = (text || '').replace(/\r/g, '')
  if (cleaned.length > MAX_SANITIZED_INPUT_CHARS) {
    return cleaned.slice(0, MAX_SANITIZED_INPUT_CHARS) + '\n... (truncated)'
  }
  return cleaned
}
