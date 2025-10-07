import { z } from 'zod'

// Marker constants for comments
export const SUMMARY_MARKER = '<!-- REVU-AI-SUMMARY -->'
export const COMMENT_MARKER_PREFIX = '<!-- REVU-AI-COMMENT '
export const COMMENT_MARKER_SUFFIX = ' -->'

// Schema for SEARCH/REPLACE blocks
const SearchReplaceBlockSchema = z.object({
  search: z.string().min(1),
  replace: z.string()
})

// Schema for individual comment validation
const CommentSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    start_line: z.number().int().positive().optional(),
    body: z.string().min(1),
    search_replace_blocks: z.array(SearchReplaceBlockSchema).optional()
  })
  .refine(
    (data) => {
      // If start_line is provided, it must be <= line
      if (data.start_line !== undefined) {
        return data.start_line <= data.line
      }
      return true
    },
    {
      message:
        'start_line must be less than or equal to line (start_line === line is valid for single-line ranges)',
      path: ['start_line']
    }
  )

// Schema for the complete analysis response
export const AnalysisSchema = z.object({
  summary: z.string(),
  comments: z.array(CommentSchema).default([])
})

// Type for GitHub API errors
interface GitHubApiError {
  status: number
  message?: string
  documentation_url?: string
}

// Type guard for GitHub API errors
export function isGitHubApiError(error: unknown): error is GitHubApiError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as GitHubApiError).status === 'number' &&
    // Check for GitHub API specific properties
    ('message' in error || 'documentation_url' in error) &&
    // Check for HTTP error status codes
    (error as GitHubApiError).status >= 400 &&
    (error as GitHubApiError).status < 600
  )
}

// Type for comment existence check results
export type CommentExistenceResult =
  | { exists: true }
  | { exists: false; reason: 'not_found' }
  | { exists: false; reason: 'error'; error: unknown }

// Inferred types from schemas
export type Comment = z.infer<typeof CommentSchema>
export type SearchReplaceBlock = z.infer<typeof SearchReplaceBlockSchema>
