# Branch Filter Configuration

Revu can skip processing pull requests based on the head branch name. This is useful to:
- Block WIP/experimental branches
- Only allow reviews on protected branches (e.g., `main`, `release/*`)
- Exclude temporary branches such as `throwaway/*`

Key properties:
- Source of truth: .revu.yml in the repository root
- Evaluation points:
  - GitHub App webhooks: before analysis (silent skip with a log line)
  - CLI (review-pr): before analysis (prints a single-line notice, exits 0)
- Fail-open: If the configuration cannot be read or contains errors, Revu proceeds with the review

## YAML schema (patterns-only, last-match-wins)

```yaml
branches:
  patterns:
    - "**"                 # baseline: default-allow (or use "!**" for default-deny)
    - "!wip/**"            # deny examples
    - "!experimental/**"
    - "!regex:/^throwaway\//"
    - "release/**"         # allow examples
    - "regex:/^hotfix\/\d+$/i"
```

Behavior rules:
- Ordered list; the last matching pattern decides the outcome.
- Negation: prefix with "!" to deny on match (e.g., "!wip/**" or "!regex:/^foo/").
- Baselines:
  - Default-allow: start with "**" and add "!deny" entries.
  - Default-deny: start with "!**" and add specific allowed entries.
- Branch names are normalized (refs/heads/ prefix is removed) before matching.

## Pattern syntax

Two pattern types are supported. You can mix both within the same list.

1) Glob-like patterns using picomatch semantics:
- `*` matches within a single path segment
- `?` matches a single character
- `**` matches across path segments
- Examples:
  - `main`
  - `release/*`
  - `feature/**`
  - `hot?ix/*`

2) Regex literals using `regex:/…/flags` form:
- Example: `regex:/^release\/\d+$/i`
- The part between the slashes is passed to RegExp; flags are optional (e.g., `i` for case-insensitive)

Notes:
- Malformed regex entries are ignored and a warning is logged (does not crash).
- Branch names commonly look like `feature/foo`, `release/2025-09`, etc.

## Examples

Default-allow with targeted denies:
```yaml
branches:
  patterns:
    - "**"
    - "!wip/**"
    - "!experimental/**"
    - "!regex:/^throwaway\//"
```

Default-deny (allow-list):
```yaml
branches:
  patterns:
    - "!**"
    - "main"
    - "release/*"
    - "regex:/^hotfix\/\d+$/i"
```

Ordering (last match wins):
```yaml
branches:
  patterns:
    - "release/**"
    - "!release/bad/*"   # denies the bad subset
```

## Operational details

- Webhooks path (`src/webhooks.ts`): if blocked, Revu logs a single system_warn entry and returns without processing.
- CLI path (`src/cli/review-pr.ts`): if blocked, prints `Branch filtered by .revu.yml (branches) — skipping review.` and returns.
- Implementation utilities:
  - `src/core/utils/branch-filter.ts` provides `isBranchAllowed()` and `normalizeBranch()`.
  - `src/config-handler.ts` provides `getBranchesConfig()` and `shouldProcessBranch()` helpers.

If the `branches` section is omitted in `.revu.yml`, Revu behaves as before (no branch filtering).
