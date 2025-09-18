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

## YAML schema

```yaml
branches:
  mode: allow | deny       # optional; default is deny (allow all unless denied)
  allow:                   # optional; list of patterns
    - main
    - release/*
    - regex:/^hotfix\/\d+$/i
  deny:                    # optional; list of patterns
    - wip/*
    - experimental/**
    - regex:/^throwaway\//
```

Behavior rules:
- Deny takes precedence. If any deny pattern matches, the branch is blocked.
- mode: allow → default-deny; only branches matching at least one allow pattern are processed (unless denied).
- mode: deny (or missing) → default-allow; all branches are processed except those matching deny.
- Branch names are normalized (refs/heads/ prefix is removed) before matching.

## Pattern syntax

Two pattern types are supported. You can mix both within the same list.

1) Glob-like (gitignore-style) patterns using the `ignore` library semantics:
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
- A malformed regex entry is ignored as non-matching (does not crash).
- Branch names commonly look like `feature/foo`, `release/2025-09`, etc.

## Examples

Allow-list only:
```yaml
branches:
  mode: allow
  allow:
    - main
    - release/*
    - regex:/^hotfix\/\d+$/i
```

Deny-list only:
```yaml
branches:
  mode: deny
  deny:
    - wip/*
    - experimental/**
    - regex:/^throwaway\//
```

Mixed with deny precedence:
```yaml
branches:
  mode: allow
  allow:
    - release/**
  deny:
    - release/bad/*
```

## Operational details

- Webhooks path (`src/webhooks.ts`): if blocked, Revu logs a single system_warn entry and returns without processing.
- CLI path (`src/cli/review-pr.ts`): if blocked, prints `Branch filtered by .revu.yml (branches) — skipping review.` and returns.
- Implementation utilities:
  - `src/core/utils/branch-filter.ts` provides `isBranchAllowed()` and `normalizeBranch()`.
  - `src/config-handler.ts` provides `getBranchesConfig()` and `shouldProcessBranch()` helpers.

If the `branches` section is omitted in `.revu.yml`, Revu behaves as before (no branch filtering).
