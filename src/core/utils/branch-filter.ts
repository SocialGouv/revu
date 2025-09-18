import picomatch from 'picomatch'
import * as logger from '../../utils/logger.ts'

export interface BranchFilterConfig {
  mode?: 'allow' | 'deny'
  allow?: string[]
  deny?: string[]
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

function splitPatterns(patterns?: string[]) {
  const globs: string[] = []
  const regexes: RegexDescriptor[] = []
  if (!patterns) return { globs, regexes }

  for (const raw of patterns) {
    const desc = parseRegexLiteral(raw)
    if (desc) {
      regexes.push(desc)
      continue
    }

    // Malformed regex literal (starts with regex:/ but missing closing /)
    if (raw.toLowerCase().startsWith('regex:/')) {
      logger.logSystemWarning(
        new Error('Invalid regex literal in branches filter'),
        {
          context_msg: `pattern="${raw}"`
        }
      )
      continue
    }

    // Disallow negated glob patterns for predictability (not documented)
    if (raw.startsWith('!')) {
      logger.logSystemWarning(
        new Error('Unsupported negated glob pattern in branches filter'),
        { context_msg: `Pattern "${raw}" is ignored` }
      )
      continue
    }

    globs.push(raw)
  }

  return { globs, regexes }
}

function regexMatches(regexes: RegexDescriptor[], value: string): boolean {
  for (const r of regexes) {
    try {
      const re = new RegExp(r.pattern, r.flags)
      if (re.test(value)) return true
    } catch {
      // If regex cannot compile, treat as non-match but warn for visibility
      logger.logSystemWarning(new Error('Invalid regex in branches filter'), {
        context_msg: `pattern="${r.pattern}" flags="${r.flags ?? ''}"`
      })
    }
  }
  return false
}

function globMatches(globs: string[], value: string): boolean {
  if (globs.length === 0) return false
  for (const g of globs) {
    // Use picomatch so '*' does not cross '/', while '**' spans segments
    if (picomatch.isMatch(value, g)) return true
  }
  return false
}

function matchesAny(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) return false
  const { globs, regexes } = splitPatterns(patterns)
  return globMatches(globs, value) || regexMatches(regexes, value)
}

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
  if (!cfg) return true

  const b = normalizeBranch(branch)

  if (matchesAny(cfg.deny, b)) {
    return false
  }

  if (cfg.mode === 'allow') {
    return matchesAny(cfg.allow, b)
  }

  // default mode: deny-list (allow unless explicitly denied)
  return true
}
