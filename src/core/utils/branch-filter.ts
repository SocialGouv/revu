import picomatch from 'picomatch'
import * as logger from '../../utils/logger.ts'

export interface BranchFilterConfig {
  /**
   * Ordered list of patterns. Last matching pattern wins.
   * Supports:
   * - Globs (picomatch semantics): *, **, ?
   * - Regex literals: regex:/pattern/flags
   * - Negation: prefix '!' to deny on match (e.g., '!wip/**' or '!regex:/^foo/')
   */
  patterns?: string[]
}

/**
 * Normalize a branch name by removing refs/heads/ prefix if present.
 */
export function normalizeBranch(branch: string): string {
  if (branch.startsWith('refs/heads/')) {
    return branch.slice('refs/heads/'.length)
  }
  return branch
}

type RegexDescriptor = { pattern: string; flags?: string }

/**
 * Parse a literal of the form: regex:/.../flags
 * Handles escaped slashes within the pattern body.
 */
function parseRegexLiteral(input: string): RegexDescriptor | null {
  const lower = input.toLowerCase()
  const prefix = 'regex:/'
  if (!lower.startsWith(prefix)) return null

  const start = prefix.length
  // Find the last unescaped slash to separate pattern and flags
  let slashIndex = -1
  for (let i = input.length - 1; i >= start; i--) {
    if (input[i] !== '/') continue

    // Count preceding backslashes to determine if this slash is escaped
    let backslashes = 0
    for (let k = i - 1; k >= start && input[k] === '\\'; k--) backslashes++
    const isEscaped = backslashes % 2 === 1
    if (!isEscaped) {
      slashIndex = i
      break
    }
  }
  if (slashIndex === -1) return null

  const pattern = input.slice(start, slashIndex)
  const flags = input.slice(slashIndex + 1) || undefined
  return { pattern, flags }
}

/**
 * Evaluate ordered patterns with last-match-wins semantics.
 * - '!' prefix negates (deny on match)
 * - regex:/.../flags supported (also with '!' negation).
 * - If no pattern matches, default allow (fail-open).
 */
function evaluatePatterns(patterns: string[], value: string): boolean {
  let decision: boolean | undefined

  for (let raw of patterns) {
    let neg = false
    if (raw.startsWith('!')) {
      neg = true
      raw = raw.slice(1)
    }

    if (raw.toLowerCase().startsWith('regex:/')) {
      const desc = parseRegexLiteral(raw)
      if (!desc) {
        logger.logSystemWarning(
          new Error('Invalid regex literal in branches filter'),
          {
            context_msg: `pattern="${raw}"`
          }
        )
        continue
      }
      try {
        const re = new RegExp(desc.pattern, desc.flags)
        if (re.test(value)) decision = !neg
      } catch {
        logger.logSystemWarning(new Error('Invalid regex in branches filter'), {
          context_msg: `pattern="${desc.pattern}" flags="${desc.flags ?? ''}"`
        })
      }
      continue
    }

    // Glob (picomatch)
    try {
      // Pre-validate glob for common syntax issues (e.g., unbalanced brackets)
      picomatch.makeRe(raw, { strictBrackets: true })
    } catch {
      logger.logSystemWarning(new Error('Invalid glob in branches filter'), {
        context_msg: `pattern="${raw}"`
      })
      continue
    }
    if (picomatch.isMatch(value, raw)) {
      decision = !neg
    }
  }

  // Fail-open if no match
  return decision ?? true
}

/* Legacy helpers removed under patterns-only model */

/**
 * Evaluate branch allowance based on BranchFilterConfig.
 * Rules:
 * - Deny list takes precedence: if any deny matches => disallowed.
 * - If mode === 'allow': allowed only if allow list matches.
 * - Otherwise (mode === 'deny' or absent): allowed by default.
 */
export function isBranchAllowed(
  branch: string,
  cfg?: BranchFilterConfig
): boolean {
  // Fail-open if no config or no patterns
  if (!cfg || !cfg.patterns || cfg.patterns.length === 0) return true

  const b = normalizeBranch(branch)
  return evaluatePatterns(cfg.patterns, b)
}
