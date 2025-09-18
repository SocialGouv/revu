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

function parseRegexLiteral(input: string): RegexDescriptor | null {
  // Accept forms like: regex:/^foo$/  or regex:/^bar/i
  const match = /^regex:\/(.+)\/([a-z]*)$/i.exec(input)
  if (!match) return null
  return { pattern: match[1], flags: match[2] || undefined }
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supported:
 *  - *  : any chars except '/'
 *  - ?  : any single char except '/'
 *  - ** : any chars including '/'
 */
function globToRegExp(pattern: string): RegExp {
  let re = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    const next = i + 1 < pattern.length ? pattern[i + 1] : ''

    // Handle **
    if (c === '*' && next === '*') {
      re += '.*'
      i++ // skip next '*'
      continue
    }

    if (c === '*') {
      re += '[^/]*'
      continue
    }

    if (c === '?') {
      re += '[^/]'
      continue
    }

    // Escape regex special chars
    if ('\\.[]{}()+-^$|'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  re += '$'
  return new RegExp(re)
}

function matchOne(pattern: string, value: string): boolean {
  const regexDesc = parseRegexLiteral(pattern)
  if (regexDesc) {
    try {
      const re = new RegExp(regexDesc.pattern, regexDesc.flags)
      return re.test(value)
    } catch {
      // If regex cannot compile, treat as non-match
      return false
    }
  }
  const re = globToRegExp(pattern)
  return re.test(value)
}

function matchesAny(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) return false
  for (const pat of patterns) {
    if (matchOne(pat, value)) return true
  }
  return false
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
