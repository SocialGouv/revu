import type { PlatformContext } from '../core/models/platform-types.ts'

// Marker to identify our AI error comments
const ERROR_COMMENT_MARKER = '<!-- REVU-AI-ERROR -->'

/**
 * Generates a Grafana logs URL with timestamps from 5 minutes ago to now
 */
function generateGrafanaLogsUrl(): string {
  // Current time in milliseconds
  const now = Date.now()

  const fiveMinutesInMs = 5 * 60 * 1000

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
          from: `${now - fiveMinutesInMs}`,
          to: `${now + fiveMinutesInMs}`
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

const createFormattedError = (errorMessage: string): string => {
  const grafanaLogsUrl = generateGrafanaLogsUrl()
  return `${ERROR_COMMENT_MARKER}

An error occurred: ${errorMessage}

[Revu logs](${grafanaLogsUrl})`
}

/**
 * Platform-agnostic error comment handler using functional programming principles
 * Refactored from GitHub-specific to platform-agnostic implementation
 */
export async function errorCommentHandler(
  platformContext: PlatformContext,
  prNumber: number,
  errorMessage: string
): Promise<string> {
  const formattedError = createFormattedError(errorMessage)

  try {
    await platformContext.client.createReview(prNumber, formattedError)
    return `Posted error comment on PR #${prNumber}`
  } catch (error) {
    console.error(`Failed to post error comment: ${error}`)
    return `Failed to post error comment: ${error.message || String(error)}`
  }
}
