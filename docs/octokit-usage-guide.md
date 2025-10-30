# Octokit Usage Guide

This document outlines the proper usage patterns for Octokit instances in the Revu codebase and explains when to create new instances versus reusing existing ones. It also documents our centralized retry strategy built on p-retry.

## General Principle

Always prefer using `context.octokit` from Probot contexts when available. Only create new Octokit instances when absolutely necessary.

## Centralized Retries with p-retry

Revu centralizes all Octokit request retries via a single hook to reduce per-call verbosity and ensure consistent, safe retry behavior.

- Implementation: `src/github/retry-hook.ts`
- Helper: `attachOctokitRetry(octokit, ctx?)`
- Underlying retry utility: `withRetryOctokit` from `src/utils/retry.ts`
- Double-wrap protection: If an Octokit instance already has `plugin-retry` (i.e., `octokit.retry` exists), our hook is not attached.
- Test mode: In tests (NODE_ENV=test or Vitest), backoff delays are set to 0 to keep tests fast.

### How it works

The hook wraps the base Octokit request pipeline:

- Classifies errors consistently:
  - Retries: network errors, 5xx, and 429 (Too Many Requests)
  - 403: retried only when rate-limited (Retry-After header or X-RateLimit-Remaining=0); otherwise aborts
  - Other 4xx: aborts immediately
- Method-aware policies:
  - read (GET/HEAD/OPTIONS): retries=5, minTimeout=500ms, maxTimeout=5000ms
  - write (POST/PUT/PATCH): retries=2, minTimeout=1000ms, maxTimeout=2000ms
  - delete (DELETE): retries=2, minTimeout=1000ms, maxTimeout=2000ms
    - Optional idempotency for missing resources: default is NOT to swallow 404/410
    - Per-call opt-in via `revuDeleteTreat404AsSuccess: true`
- Per-call policy override via `revuRetryPolicy`:
  - `'default' | 'read' | 'write' | 'delete' | 'none'`
  - `'none'` bypasses retries for that call

### Attaching the hook

The hook is attached in Probot flows to the context’s Octokit instance, and in utilities that create their own Octokit instances:

```ts
// In Probot handlers (example in src/webhooks.ts)
import { attachOctokitRetry } from '../src/github/retry-hook.ts'

export async function onSomeEvent(context: any) {
  const repo = context.repo()
  attachOctokitRetry(context.octokit, {
    repository: `${repo.owner}/${repo.repo}`,
    pr_number: context.payload.pull_request?.number
  })
  // All subsequent Octokit calls through context.octokit are retried per policy
}
```

```ts
// For manually created instances (e.g., CLI or proxy client)
import { Octokit } from '@octokit/rest'
import { attachOctokitRetry } from '../src/github/retry-hook.ts'

const octokit = attachOctokitRetry(
  new Octokit({ auth: process.env.SOME_TOKEN }),
  { repository: 'owner/repo' }
)
```

Our hook will skip attaching if `octokit.retry` exists to avoid double-wrapping when `@octokit/plugin-retry` is present.

### Per-call overrides and idempotent DELETE

```ts
// Force a specific policy (e.g., bypass retries entirely)
await octokit.request('GET /rate_limit', {
  revuRetryPolicy: 'none'
})

// Opt-in to treat DELETE 404/410 as success (idempotent behavior)
await octokit.request(
  'DELETE /repos/{owner}/{repo}/branches/{branch}/protection',
  {
    owner,
    repo,
    branch,
    revuDeleteTreat404AsSuccess: true // returns { status: 204, data: undefined } on 404/410
  }
)
```

### Context updates and instance reuse

`attachOctokitRetry()` can be called multiple times on the same Octokit instance to update the contextual metadata used for retry logging and classification (e.g., `repository`, `pr_number`). Internally, the hook stores per-instance state in a WeakMap and the wrapper reads the latest context at request time, so re-attaching updates the effective context without double-wrapping.

- Behavior
  - Repeated calls update context for the same instance (no double wrapping).
  - The wrapper is attached only once; subsequent calls refresh context.
  - If `@octokit/plugin-retry` is detected, our hook will not attach; context updates are tracked but unused while the plugin is active.

- API
  - `attachOctokitRetry(octokit, ctx?, opts?)`
    - `ctx`: `{ repository?: string; pr_number?: number }`
    - `opts?: { force?: boolean }`:
      - `force` is typically unnecessary since the wrapper reads context dynamically.
      - Even with `force`, our hook will still skip attaching if `@octokit/plugin-retry` is present to avoid double-wrapping.

- Guidance
  - Prefer not to share a single Octokit instance across unrelated repositories or long-lived flows. If you must reuse the instance across different PRs or repos, call `attachOctokitRetry` again with the new `ctx` to refresh the context.
  - Do not mix multiple retry layers (e.g., our hook plus `@octokit/plugin-retry`); our hook intentionally stays inactive when the plugin is present.

## Fetch and Anthropic retries

Non-Octokit calls are also standardized with p-retry wrappers in `src/utils/retry.ts`:

- `withRetryFetch(input, init?, options?)`:
  - Retries on 5xx/429 and network errors
  - Aborts on other 4xx (throws an AbortError with status)
  - Example:

```ts
import { withRetryFetch } from '../src/utils/retry.ts'

const res = await withRetryFetch(
  'https://api.example.com/resource',
  { method: 'GET' },
  {
    retries: 5 // optional override
  }
)
```

- `withRetryAnthropic(fn, options?)`:
  - Retries on 5xx/429 and network errors
  - Aborts on other 4xx
  - Example:

```ts
import { withRetryAnthropic } from '../src/utils/retry.ts'

const result = await withRetryAnthropic(() => anthropic.messages.create({...}), {
  retries: 3
})
```

- Generic `withRetry(fn, options?)`:
  - Use for other API clients with the same classification defaults
  - Options support `context` (for logging) and `shouldAbort` override.

### Defaults and tuning

- Environment-variable override for generic retries:
  - `P_RETRY_RETRIES` (non-negative integer) to set a default retry count
- Test-friendly defaults:
  - `NODE_ENV=test` (and Vitest) => zero timing backoff in both utilities and the Octokit hook
- Logging:
  - Non-test retry attempts log a system warning with the operation context

## Usage Patterns

### ✅ Preferred: Use Context Octokit

When working within Probot event handlers, always use the octokit instance from the context:

```ts
// ✅ Good - Use context octokit
export async function someHandler(context: any) {
  const { data } = await context.octokit.rest.pulls.get({
    owner: 'owner',
    repo: 'repo',
    pull_number: 123
  })
}

// ✅ Even better - Use utility function for safety
import { getContextOctokit } from '../github/context-utils.ts'

export async function someHandler(context: any) {
  const octokit = getContextOctokit(context)
  const { data } = await octokit.rest.pulls.get({
    owner: 'owner',
    repo: 'repo',
    pull_number: 123
  })
}
```

### ✅ Legitimate: Different Authentication

Create new Octokit instances when you need different authentication:

```ts
// ✅ Legitimate - Proxy user authentication
export function createProxyClient(): Octokit | null {
  const proxyToken = process.env.PROXY_REVIEWER_TOKEN
  if (!proxyToken) return null

  return new Octokit({
    auth: proxyToken
  })
}
```

### ✅ Legitimate: CLI Operations

CLI tools don't have Probot contexts, so they must create their own instances:

```ts
// ✅ Legitimate - CLI needs its own octokit
const octokit = await createGithubAppOctokit(owner, repo)
const context = await createMinimalContext(owner, repo, octokit)
```

### ❌ Avoid: Unnecessary Creation

Don't create new instances when context.octokit is available:

```ts
// ❌ Bad - Unnecessary octokit creation
export async function badHandler(context: any) {
  const octokit = await createGithubAppOctokit(owner, repo) // Unnecessary!
  // Should use context.octokit instead
}
```

## Current Legitimate Uses

1. GitHub App Utilities (`src/github/utils.ts`)
   - Purpose: Foundational utilities for GitHub App authentication
   - Used by: CLI tool and installation token generation
   - Why legitimate: Provides app-level and installation-level authentication

2. Proxy Client (`src/comment-handlers/line-comments-handler.ts`)
   - Purpose: Posts comments as proxy user instead of GitHub App
   - Why legitimate: Uses different authentication token (proxy user's PAT)

3. CLI Context Builder (`src/github/context-builder.ts`)
   - Purpose: Creates minimal context for CLI operations
   - Why legitimate: CLI doesn't have Probot context available

4. CLI Tool (`src/cli/review-pr.ts`)
   - Purpose: Standalone PR review tool
   - Why legitimate: No Probot context available in CLI environment

## Utility Functions

### Safe Context Access

Use the utility functions from `src/github/context-utils.ts`:

```ts
import { getContextOctokit, hasValidOctokit } from '../github/context-utils.ts'

// Safe extraction with error handling
const octokit = getContextOctokit(context)

// Check before using
if (hasValidOctokit(context)) {
  // Safe to use context.octokit
}
```

## Type Consistency

### Use Correct Types

- ProbotOctokit: For context.octokit instances
- Octokit: For manually created instances

```ts
import type { ProbotOctokit } from 'probot'
import type { Octokit } from '@octokit/rest'

// ✅ Correct types
function useContextOctokit(octokit: ProbotOctokit) {}
function useManualOctokit(octokit: Octokit) {}
```

## Best Practices

1. Always check context first: Before creating a new Octokit, verify that context.octokit isn't available
2. Document necessity: When creating new instances, add comments explaining why it's necessary
3. Use utility functions: Leverage `getContextOctokit()` for safer access
4. Consistent typing: Use `ProbotOctokit` for context instances, `Octokit` for manual instances
5. Error handling: Always handle cases where octokit creation might fail
6. Retrying:
   - Do not wrap individual calls with `withRetryOctokit` if you use `attachOctokitRetry` on the instance
   - Use per-call overrides (`revuRetryPolicy`, `revuDeleteTreat404AsSuccess`) for special cases
   - Avoid mixing multiple retry layers (e.g., plugin-retry plus our hook)

## Migration Checklist

When refactoring octokit usage:

- [x] Ensure `attachOctokitRetry()` is applied to Octokit instances (context and manual)
- [x] Do not double-wrap when `@octokit/plugin-retry` is present
- [x] Replace per-call retry wrappers with centralized hook
- [ ] Check if context.octokit is available
- [ ] Replace unnecessary `createGithubAppOctokit()` calls
- [ ] Update type imports (`Octokit` → `ProbotOctokit` where appropriate)
- [ ] Add safety checks with utility functions
- [ ] Document remaining legitimate uses
- [ ] Test authentication still works correctly
