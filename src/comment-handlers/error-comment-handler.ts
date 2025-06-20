import { type Context } from 'probot'
import { upsertComment } from './global-comment-handler.ts'

// Marker to identify our AI error comments
const ERROR_COMMENT_MARKER = '<!-- REVU-AI-ERROR -->'

/**
 * Find existing AI error comment by looking for the unique marker
 */
async function findExistingErrorComment(context: Context, prNumber: number) {
  const repo = context.repo()

  // Get all comments on the PR
  const { data: comments } = await context.octokit.issues.listComments({
    ...repo,
    issue_number: prNumber
  })

  // Find the comment with our marker
  return comments.find((comment) => comment.body.includes(ERROR_COMMENT_MARKER))
}

/**
 * Generates a Grafana logs URL with timestamps from 5 minutes ago to now
 */
function generateGrafanaLogsUrl(): string {
  // Current time in milliseconds
  const now = Date.now()

  // 5 minutes ago in milliseconds (5 * 60 * 1000)
  const fiveMinutesAgo = now - 300000

  // Base Grafana URL with the timestamps inserted
  const baseUrl = 'https://grafana.fabrique.social.gouv.fr/explore'
  const params = {
    schemaVersion: '1',
    panes: JSON.stringify({
      y1w: {
        datasource: 'P8E80F9AEF21F6940',
        queries: [
          {
            refId: 'A',
            expr: '{cluster="ovh-prod", namespace="revu", container="app"} |= ``',
            queryType: 'range',
            datasource: {
              type: 'loki',
              uid: 'P8E80F9AEF21F6940'
            },
            editorMode: 'builder',
            direction: 'forward'
          }
        ],
        range: {
          from: `${fiveMinutesAgo}`,
          to: `${now}`
        }
      }
    }),
    orgId: '1'
  }

  const queryString = Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`
    )
    .join('&')

  return `${baseUrl}?${queryString}`
}

/**
 * Handles the creation or update of an error comment.
 * This is used when an error occurs during processing.
 */
export async function errorCommentHandler(
  context: Context,
  prNumber: number,
  errorMessage: string
): Promise<string> {
  // Generate the Grafana logs URL with dynamic timestamps
  const grafanaLogsUrl = generateGrafanaLogsUrl()

  // Format the error message with our marker and the Grafana logs link
  const formattedError = `${ERROR_COMMENT_MARKER}

An error occurred: ${errorMessage}

[Revu logs](${grafanaLogsUrl})`

  // Check if we already have an error comment
  const existingComment = await findExistingErrorComment(context, prNumber)

  // Create or update the comment
  return await upsertComment(context, existingComment, formattedError, prNumber)
}
