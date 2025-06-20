import { type Context } from 'probot'
import { z } from 'zod'
import { fetchPrDiff } from '../extract-diff.ts'
import {
  globalCommentHandler,
  upsertComment
} from './global-comment-handler.ts'

// Marker for the global summary comment
const SUMMARY_MARKER = '<!-- REVU-AI-SUMMARY -->'

// Marker pattern for individual comments
// Each comment gets a unique ID based on file path and line number
const COMMENT_MARKER_PREFIX = '<!-- REVU-AI-COMMENT '
const COMMENT_MARKER_SUFFIX = ' -->'

/**
 * Creates a unique marker ID for a specific comment
 */
function createCommentMarkerId(
  path: string,
  line: number,
  start_line?: number
): string {
  // Create a deterministic ID based on file path and line number(s)
  const lineRange =
    start_line !== undefined ? `${start_line}-${line}` : `${line}`
  return `${path}:${lineRange}`.replace(/[^a-zA-Z0-9-_:.]/g, '_')
}

/**
 * Extracts the marker ID from a comment body
 */
function extractMarkerIdFromComment(commentBody: string): string | null {
  const match = commentBody.match(
    new RegExp(
      `${COMMENT_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.+?)${COMMENT_MARKER_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    )
  )
  return match ? match[1] : null
}

/**
 * Cleans up obsolete comments that are no longer relevant in the current diff
 */
async function cleanupObsoleteComments(
  context: Context,
  prNumber: number,
  diffMap: Map<string, { changedLines: Set<number> }>
): Promise<number> {
  const repo = context.repo()
  let deletedCount = 0

  // Get existing review comments
  const existingComments = await findExistingComments(context, prNumber)

  for (const comment of existingComments) {
    // Extract the marker ID from the comment
    const markerId = extractMarkerIdFromComment(comment.body)
    if (!markerId) {
      continue // Skip comments without our marker format
    }

    // Parse the marker ID to get path and line(s)
    const [path, lineStr] = markerId.split(':')

    // Check if it's a range (multi-line) or single line
    const isRange = lineStr.includes('-')
    let shouldDelete = false

    const fileInfo = diffMap.get(path)
    if (!fileInfo) {
      shouldDelete = true
    } else if (isRange) {
      // Multi-line comment: check if ALL lines in range are still in diff
      const [startStr, endStr] = lineStr.split('-')
      const startLine = parseInt(startStr, 10)
      const endLine = parseInt(endStr, 10)

      if (isNaN(startLine) || isNaN(endLine)) {
        continue // Skip if we can't parse the line numbers
      }

      // Check if all lines in the range are still in the diff
      const allLinesInDiff = Array.from(
        { length: endLine - startLine + 1 },
        (_, i) => startLine + i
      ).every((line) => fileInfo.changedLines.has(line))

      shouldDelete = !allLinesInDiff
    } else {
      // Single line comment
      const line = parseInt(lineStr, 10)
      if (isNaN(line)) {
        continue // Skip if we can't parse the line number
      }
      shouldDelete = !fileInfo.changedLines.has(line)
    }

    if (shouldDelete) {
      try {
        // Delete the obsolete comment
        await context.octokit.pulls.deleteReviewComment({
          ...repo,
          comment_id: comment.id
        })
        deletedCount++
      } catch (error) {
        console.error(`Failed to delete comment ${comment.id}:`, error)
        // Continue processing other comments even if one fails
      }
    }
  }

  return deletedCount
}

/**
 * Finds all existing review comments on a PR that have our marker
 */
async function findExistingComments(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all review comments on the PR
  const { data: comments } = await context.octokit.pulls.listReviewComments({
    ...repo,
    pull_number: prNumber
  })

  // Filter to comments with our marker
  return comments.filter((comment) =>
    comment.body.includes(COMMENT_MARKER_PREFIX)
  )
}

/**
 * Find the existing summary comment
 */
async function findExistingSummaryComment(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all comments on the PR
  const { data: comments } = await context.octokit.issues.listComments({
    ...repo,
    issue_number: prNumber
  })

  // Find the comment with our marker
  return comments.find((comment) => comment.body.includes(SUMMARY_MARKER))
}

// Type pour les erreurs GitHub API
interface GitHubApiError {
  status: number
  message?: string
}

// Type guard pour vérifier si une erreur est une erreur GitHub API
function isGitHubApiError(error: unknown): error is GitHubApiError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as GitHubApiError).status === 'number'
  )
}

// Schémas de validation pour garantir le bon format de la réponse
const CommentSchema = z
  .object({
    path: z.string(),
    line: z.number().int().positive(),
    start_line: z.number().int().positive().optional(),
    body: z.string(),
    suggestion: z.string().optional().nullable()
  })
  .refine(
    (data) => {
      // Si start_line est fourni, il doit être <= line
      if (data.start_line !== undefined) {
        return data.start_line <= data.line
      }
      return true
    },
    {
      message: 'start_line must be less than or equal to line',
      path: ['start_line']
    }
  )

const AnalysisSchema = z.object({
  summary: z.string(),
  comments: z.array(CommentSchema)
})

/**
 * Handles the creation of individual review comments on specific lines.
 * This expects the analysis to be a JSON string with the following structure:
 * {
 *   "summary": "Overall PR summary",
 *   "comments": [
 *     {
 *       "path": "file/path.ts",
 *       "line": 42,
 *       "body": "Comment text",
 *       "suggestion": "Optional suggested code"
 *     }
 *   ]
 * }
 */
export async function lineCommentsHandler(
  context: Context,
  prNumber: number,
  analysis: string
) {
  const repo = context.repo()

  try {
    // Parse the JSON response
    const rawParsedAnalysis = JSON.parse(analysis)

    // Valider la structure avec Zod
    const validationResult = AnalysisSchema.safeParse(rawParsedAnalysis)

    if (!validationResult.success) {
      console.error(
        "Validation de l'analyse échouée :",
        validationResult.error.format()
      )
      throw new Error(
        "Format d'analyse invalide : " + validationResult.error.message
      )
    }

    // Utiliser le résultat validé et typé
    const parsedAnalysis = validationResult.data

    // Format the summary with our marker
    const formattedSummary = `${SUMMARY_MARKER}\n\n${parsedAnalysis.summary}`

    // Handle the summary comment (global PR comment)
    const existingSummary = await findExistingSummaryComment(context, prNumber)

    await upsertComment(context, existingSummary, formattedSummary, prNumber)

    // Get the commit SHA for the PR head
    const { data: pullRequest } = await context.octokit.pulls.get({
      ...repo,
      pull_number: prNumber
    })
    const commitSha = pullRequest.head.sha

    // Fetch PR diff to identify changed lines
    const diffMap = await fetchPrDiff(context, prNumber)

    // Clean up obsolete comments first
    const deletedCount = await cleanupObsoleteComments(
      context,
      prNumber,
      diffMap
    )

    // Get existing review comments AFTER cleanup
    const existingComments = await findExistingComments(context, prNumber)

    // Track created/updated comments
    let createdCount = 0
    let updatedCount = 0
    let skippedCount = 0

    // Process each comment
    for (const comment of parsedAnalysis.comments) {
      // Generate marker ID for this comment
      const markerId = createCommentMarkerId(
        comment.path,
        comment.line,
        comment.start_line
      )

      // Format the comment body with marker
      let commentBody = `${COMMENT_MARKER_PREFIX}${markerId}${COMMENT_MARKER_SUFFIX}\n\n${comment.body}`

      // Add suggested code if available
      if (comment.suggestion) {
        commentBody += '\n\n```suggestion\n' + comment.suggestion + '\n```'
      }

      // Check if this comment already exists
      const existingComment = existingComments.find(
        (existing) =>
          existing.body.includes(`${COMMENT_MARKER_PREFIX}${markerId}`) &&
          existing.path === comment.path
      )

      if (existingComment) {
        try {
          // Update existing comment
          await context.octokit.pulls.updateReviewComment({
            ...repo,
            comment_id: existingComment.id,
            body: commentBody
          })
          updatedCount++
        } catch (error: unknown) {
          if (isGitHubApiError(error) && error.status === 404) {
            // Le commentaire a été supprimé entre temps, on crée un nouveau commentaire
            console.log(
              `Comment ${existingComment.id} was deleted, creating new one`
            )

            // Check if the file and lines are part of the diff before creating
            const fileInfo = diffMap.get(comment.path)
            if (!fileInfo) {
              console.log(
                `Skipping comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} - file not in diff`
              )
              skippedCount++
              continue
            }

            // For multi-line comments, check if ALL lines in the range are in the diff
            if (comment.start_line !== undefined) {
              const allLinesInDiff = Array.from(
                { length: comment.line - comment.start_line + 1 },
                (_, i) => comment.start_line! + i
              ).every((line) => fileInfo.changedLines.has(line))

              if (!allLinesInDiff) {
                console.log(
                  `Skipping comment on ${comment.path}:${comment.start_line}-${comment.line} - not all lines in diff`
                )
                skippedCount++
                continue
              }
            } else {
              // Single line comment
              if (!fileInfo.changedLines.has(comment.line)) {
                console.log(
                  `Skipping comment on ${comment.path}:${comment.line} - not part of the diff`
                )
                skippedCount++
                continue
              }
            }

            // Create new comment
            const commentParams = {
              ...repo,
              pull_number: prNumber,
              commit_id: commitSha,
              path: comment.path,
              line: comment.line,
              body: commentBody,
              ...(comment.start_line !== undefined && {
                start_line: comment.start_line,
                side: 'RIGHT' as const,
                start_side: 'RIGHT' as const
              })
            }
            await context.octokit.pulls.createReviewComment(commentParams)
            createdCount++
          } else {
            // Autre erreur, on la relance
            throw error
          }
        }
      } else {
        // Check if the file and lines are part of the diff
        const fileInfo = diffMap.get(comment.path)
        if (!fileInfo) {
          console.log(
            `Skipping comment on ${comment.path}:${comment.start_line || comment.line}-${comment.line} - file not in diff`
          )
          skippedCount++
          continue
        }

        // For multi-line comments, check if ALL lines in the range are in the diff
        if (comment.start_line !== undefined) {
          const allLinesInDiff = Array.from(
            { length: comment.line - comment.start_line + 1 },
            (_, i) => comment.start_line! + i
          ).every((line) => fileInfo.changedLines.has(line))

          if (!allLinesInDiff) {
            console.log(
              `Skipping comment on ${comment.path}:${comment.start_line}-${comment.line} - not all lines in diff`
            )
            skippedCount++
            continue
          }
        } else {
          // Single line comment
          if (!fileInfo.changedLines.has(comment.line)) {
            console.log(
              `Skipping comment on ${comment.path}:${comment.line} - not part of the diff`
            )
            skippedCount++
            continue
          }
        }

        // Prepare the comment parameters
        const commentParams = {
          ...repo,
          pull_number: prNumber,
          commit_id: commitSha,
          path: comment.path,
          line: comment.line,
          body: commentBody,
          ...(comment.start_line !== undefined && {
            start_line: comment.start_line,
            side: 'RIGHT' as const,
            start_side: 'RIGHT' as const
          })
        }

        // Create new comment
        await context.octokit.pulls.createReviewComment(commentParams)
        createdCount++
      }
    }

    return `PR #${prNumber}: Created ${createdCount}, updated ${updatedCount}, deleted ${deletedCount}, and skipped ${skippedCount} line comments`
  } catch (error) {
    // In case of error, fall back to the global comment handler
    console.error(
      'Error parsing or creating line comments, falling back to global comment:',
      error
    )
    return globalCommentHandler(context, prNumber, analysis)
  }
}
