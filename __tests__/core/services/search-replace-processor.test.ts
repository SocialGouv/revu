import { describe, expect, it } from 'vitest'
import type { SearchReplaceBlock } from '../../../src/comment-handlers/types.ts'
import {
  findMatchWithFallbacks,
  generateGitHubSuggestion,
  processSearchReplaceBlocks
} from '../../../src/core/services/search-replace-processor.ts'

describe('processSearchReplaceBlocks', () => {
  it('should process exact match replacement', async () => {
    const originalContent = `function test() {
  const old = true
  return old
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: '  const old = true',
        replace: '  const improved = true'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(true)
    expect(result.appliedBlocks).toBe(1)
    expect(result.errors).toHaveLength(0)
    expect(result.replacementContent).toBe('  const improved = true')
  })

  it('should handle line-trimmed fallback matching', async () => {
    const originalContent = `function test() {
    const old = true
    return old
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: 'const old = true', // No leading spaces
        replace: 'const improved = true'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(true)
    expect(result.appliedBlocks).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('should handle multiple blocks in order', async () => {
    const originalContent = `import React from 'react'

function Component() {
  const old = true
  return <div>{old}</div>
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: "import React from 'react'",
        replace: "import React, { useState } from 'react'"
      },
      {
        search: '  const old = true',
        replace: '  const [state, setState] = useState(true)'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(true)
    expect(result.appliedBlocks).toBe(2)
    expect(result.errors).toHaveLength(0)
    // For multiple blocks, replacementContent should contain the affected range
    expect(result.replacementContent).toBe(
      `import React, { useState } from 'react'

function Component() {
  const [state, setState] = useState(true)`
    )
  })

  it('should handle non-matching search content', async () => {
    const originalContent = `function test() {
  const value = true
  return value
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: 'const nonexistent = false',
        replace: 'const improved = true'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(false)
    expect(result.appliedBlocks).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('failed to match')
  })

  it('should handle general multi-line block replacement', async () => {
    const originalContent = `function test() {
  if (condition) {
    doSomething()
    doMore()
    finish()
  }
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: `  if (condition) {
    doSomething()
    doMore()
    finish()
  }`,
        replace: `  if (condition) {
    doSomething()
    doMore()
    doExtra()
    finish()
  }`
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(true)
    expect(result.appliedBlocks).toBe(1)
    expect(result.replacementContent).toBe(
      `  if (condition) {
    doSomething()
    doMore()
    doExtra()
    finish()
  }`
    )
  })

  it('should track original line ranges for single block', async () => {
    const originalContent = `function test() {
  const old = true
  return old
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: '  const old = true',
        replace: '  const improved = true'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(true)
    expect(result.originalStartLine).toBe(1)
    expect(result.originalEndLine).toBe(1)
  })

  it('should track original line ranges for multiple blocks', async () => {
    const originalContent = `import React from 'react'

function Component() {
  const old = true
  return <div>{old}</div>
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: "import React from 'react'",
        replace: "import React, { useState } from 'react'"
      },
      {
        search: '  const old = true',
        replace: '  const [state, setState] = useState(true)'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(true)
    expect(result.originalStartLine).toBe(0) // First block starts at line 0
    expect(result.originalEndLine).toBe(3) // Second block ends at line 3 in original content
  })

  it('should not return line ranges when no blocks are applied', async () => {
    const originalContent = `function test() {
  const value = true
  return value
}`

    const blocks: SearchReplaceBlock[] = [
      {
        search: 'const nonexistent = false',
        replace: 'const improved = true'
      }
    ]

    const result = await processSearchReplaceBlocks(originalContent, blocks)

    expect(result.success).toBe(false)
    expect(result.originalStartLine).toBeUndefined()
    expect(result.originalEndLine).toBeUndefined()
  })
})

describe('findMatchWithFallbacks', () => {
  it('should use exact match when content matches exactly', () => {
    const originalContent = `function test() {
  const value = true
  return value
}`

    const searchContent = '  const value = true'
    const result = findMatchWithFallbacks(originalContent, searchContent, 0)

    expect(result.found).toBe(true)
    expect(result.method).toBe('exact')
    expect(result.startLine).toBe(1) // Line number of the match
    expect(result.endLine).toBe(1)
  })

  it('should use line-trimmed fallback when whitespace differs', () => {
    const originalContent = `function test() {
    const value = true
    return value
}`

    const searchContent = `const value = true
return value` // Multi-line with different indentation
    const result = findMatchWithFallbacks(originalContent, searchContent, 0)

    expect(result.found).toBe(true)
    expect(result.method).toBe('line-trimmed')
  })

  it('should use block anchor fallback when exact and line-trimmed fail', () => {
    // Create content where exact and line-trimmed will fail but block anchor will succeed
    const originalContent = `function processData() {
  if (condition) {
    step1()
    step2()
    step3()
    finalStep()
  }
}`

    // Search content that:
    // 1. Won't match exactly (different indentation/formatting)
    // 2. Won't match with line-trimmed (middle content differs)
    // 3. Will match with block anchor (same first/last lines, 50%+ middle similarity)
    const searchContent = `if (condition) {
  step1()
  differentStep()
  step3()
  finalStep()
}`

    const result = findMatchWithFallbacks(originalContent, searchContent, 0)

    expect(result.found).toBe(true)
    expect(result.method).toBe('block-anchor')
    expect(result.startLine).toBeGreaterThan(0)
    expect(result.endLine).toBeGreaterThan(result.startLine)
  })

  it('should fail to match when no fallback succeeds', () => {
    const originalContent = `function test() {
  const value = true
  return value
}`

    const searchContent = `completely different content
that does not exist
in the original`

    const result = findMatchWithFallbacks(originalContent, searchContent, 0)

    expect(result.found).toBe(false)
  })

  it('should respect startLine parameter', () => {
    const originalContent = `const first = true
const second = true
const third = true`

    const searchContent = 'const first = true'

    // First match should be at line 0
    const result1 = findMatchWithFallbacks(originalContent, searchContent, 0)
    expect(result1.found).toBe(true)
    expect(result1.startLine).toBe(0)

    // Second search starting from line 1 should not find the first line
    const result2 = findMatchWithFallbacks(originalContent, searchContent, 1)
    expect(result2.found).toBe(false)

    // Search for second line should work
    const result3 = findMatchWithFallbacks(
      originalContent,
      'const second = true',
      0
    )
    expect(result3.found).toBe(true)
    expect(result3.startLine).toBe(1)
  })

  it('should handle block anchor fallback with insufficient middle line similarity', () => {
    const originalContent = `function processData() {
  if (condition) {
    step1()
    step2()
    step3()
    finalStep()
  }
}`

    // Search content with same first/last lines but <50% middle similarity
    const searchContent = `if (condition) {
  completelyDifferent()
  totallyUnrelated()
  nothingMatches()
  finalStep()
}`

    const result = findMatchWithFallbacks(originalContent, searchContent, 0)

    // Should fail because middle line similarity is below 50%
    expect(result.found).toBe(false)
  })
})

describe('generateGitHubSuggestion', () => {
  it('should generate suggestion for simple replacement', () => {
    const suggestion = generateGitHubSuggestion('  const improved = true')

    expect(suggestion).toBe('```suggestion\n  const improved = true\n```')
  })

  it('should handle multi-line changes', () => {
    const suggestion = generateGitHubSuggestion(
      'const improved = true\nconst extra = false\nreturn improved'
    )

    expect(suggestion).toContain('```suggestion')
    expect(suggestion).toContain('const improved = true')
    expect(suggestion).toContain('const extra = false')
    expect(suggestion).toContain('return improved')
    expect(suggestion).toContain('```')
  })

  it('should handle trailing newlines correctly', () => {
    const suggestion = generateGitHubSuggestion('const test = true\n')

    expect(suggestion).toBe('```suggestion\nconst test = true\n```')
  })
})
