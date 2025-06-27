# Octokit Usage Guide

This document outlines the proper usage patterns for Octokit instances in the Revu codebase and explains when to create new instances versus reusing existing ones.

## General Principle

**Always prefer using `context.octokit` from Probot contexts when available.** Only create new Octokit instances when absolutely necessary.

## Usage Patterns

### ✅ Preferred: Use Context Octokit

When working within Probot event handlers, always use the octokit instance from the context:

```typescript
// ✅ Good - Use context octokit
export async function someHandler(context: Context) {
  const { data } = await context.octokit.pulls.get({
    owner: 'owner',
    repo: 'repo',
    pull_number: 123
  })
}

// ✅ Even better - Use utility function for safety
import { getContextOctokit } from '../github/context-utils.ts'

export async function someHandler(context: Context) {
  const octokit = getContextOctokit(context)
  const { data } = await octokit.pulls.get({
    owner: 'owner',
    repo: 'repo',
    pull_number: 123
  })
}
```

### ✅ Legitimate: Different Authentication

Create new Octokit instances when you need different authentication:

```typescript
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

```typescript
// ✅ Legitimate - CLI needs its own octokit
const octokit = await createGithubAppOctokit(owner, repo)
const context = await createMinimalContext(owner, repo, octokit)
```

### ❌ Avoid: Unnecessary Creation

Don't create new instances when context.octokit is available:

```typescript
// ❌ Bad - Unnecessary octokit creation
export async function badHandler(context: Context) {
  const octokit = await createGithubAppOctokit(owner, repo) // Unnecessary!
  // Should use context.octokit instead
}
```

## Current Legitimate Uses

### 1. GitHub App Utilities (`src/github/utils.ts`)

- **Purpose**: Foundational utilities for GitHub App authentication
- **Used by**: CLI tool and installation token generation
- **Why legitimate**: Provides app-level and installation-level authentication

### 2. Proxy Client (`src/comment-handlers/line-comments-handler.ts`)

- **Purpose**: Posts comments as proxy user instead of GitHub App
- **Why legitimate**: Uses different authentication token (proxy user's PAT)

### 3. CLI Context Builder (`src/github/context-builder.ts`)

- **Purpose**: Creates minimal context for CLI operations
- **Why legitimate**: CLI doesn't have Probot context available

### 4. CLI Tool (`src/cli/review-pr.ts`)

- **Purpose**: Standalone PR review tool
- **Why legitimate**: No Probot context available in CLI environment

## Utility Functions

### Safe Context Access

Use the utility functions from `src/github/context-utils.ts`:

```typescript
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

- **ProbotOctokit**: For context.octokit instances
- **Octokit**: For manually created instances

```typescript
import type { ProbotOctokit } from 'probot'
import type { Octokit } from '@octokit/rest'

// ✅ Correct types
function useContextOctokit(octokit: ProbotOctokit) { }
function useManualOctokit(octokit: Octokit) { }
```

## Best Practices

1. **Always check context first**: Before creating a new Octokit, verify that context.octokit isn't available
2. **Document necessity**: When creating new instances, add comments explaining why it's necessary
3. **Use utility functions**: Leverage `getContextOctokit()` for safer access
4. **Consistent typing**: Use `ProbotOctokit` for context instances, `Octokit` for manual instances
5. **Error handling**: Always handle cases where octokit creation might fail

## Migration Checklist

When refactoring octokit usage:

- [ ] Check if context.octokit is available
- [ ] Replace unnecessary `createGithubAppOctokit()` calls
- [ ] Update type imports (`Octokit` → `ProbotOctokit` where appropriate)
- [ ] Add safety checks with utility functions
- [ ] Document remaining legitimate uses
- [ ] Test authentication still works correctly

## Examples of Recent Fixes

### Before (Unnecessary Creation)
```typescript
const octokit = await createGithubAppOctokit(context.repoOwner, context.repoName)
const issueDetails = await fetchIssueDetails(octokit, owner, repo, number)
```

### After (Using Context)
```typescript
const issueDetails = await fetchIssueDetails(
  getContextOctokit(context.githubContext),
  owner,
  repo,
  number
)
```

This approach ensures better performance, consistency, and maintainability while preserving necessary authentication patterns.
