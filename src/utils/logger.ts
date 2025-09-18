interface BaseLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  service: 'revu'
  event_type: string
}

interface ReviewLogEntry extends BaseLogEntry {
  event_type: 'review_started' | 'review_completed' | 'review_failed'
  pr_number: number
  repository: string
  review_type: 'on-demand' | 'automatic'
  duration_ms?: number
  comments?: {
    created: number
    updated: number
    deleted: number
    skipped: number
  }
  error_message?: string
  http_status_code?: number
}

interface SystemLogEntry extends BaseLogEntry {
  event_type: 'app_started' | 'reviewer_added' | 'system_error' | 'system_warn'
  pr_number?: number
  repository?: string
  error_message?: string
  error_stack?: string
  error_name?: string
}

interface WebhookLogEntry extends BaseLogEntry {
  event_type: 'webhook_received'
  github_event: string
  action?: string
  pr_number?: number
  repository?: string
  sender_login?: string
  sender_type?: string
  payload_size?: number
  is_processed: boolean
}

function createLogEntry<T extends ReviewLogEntry | SystemLogEntry | WebhookLogEntry>(
  partial: Omit<T, 'timestamp' | 'service'>
): T {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'revu' as const,
    ...partial
  }

  return entry as T
}

function log(entry: ReviewLogEntry | SystemLogEntry | WebhookLogEntry) {
  console.log(JSON.stringify(entry))
}

// Specialized logging functions
export function logAppStarted() {
  log(
    createLogEntry<SystemLogEntry>({
      level: 'info',
      event_type: 'app_started'
    })
  )
}

export function logReviewStarted(
  prNumber: number,
  repository: string,
  reviewType: 'on-demand' | 'automatic'
) {
  log(
    createLogEntry<ReviewLogEntry>({
      level: 'info',
      event_type: 'review_started',
      pr_number: prNumber,
      repository,
      review_type: reviewType
    })
  )
}

export function logReviewCompleted(
  prNumber: number,
  repository: string,
  reviewType: 'on-demand' | 'automatic',
  durationMs: number,
  comments: {
    created: number
    updated: number
    deleted: number
    skipped: number
  }
) {
  log(
    createLogEntry<ReviewLogEntry>({
      level: 'info',
      event_type: 'review_completed',
      pr_number: prNumber,
      repository,
      review_type: reviewType,
      duration_ms: durationMs,
      comments
    })
  )
}

export function logReviewFailed(
  prNumber: number,
  repository: string,
  reviewType: 'on-demand' | 'automatic',
  error: string,
  httpStatusCode?: number
) {
  log(
    createLogEntry<ReviewLogEntry>({
      level: 'error',
      event_type: 'review_failed',
      pr_number: prNumber,
      repository,
      review_type: reviewType,
      error_message: error,
      ...(httpStatusCode && { http_status_code: httpStatusCode })
    })
  )
}

export function logReviewerAdded(prNumber: number, repository: string) {
  log(
    createLogEntry<SystemLogEntry>({
      level: 'info',
      event_type: 'reviewer_added',
      pr_number: prNumber,
      repository
    })
  )
}

interface SystemErrorContext {
  pr_number?: number
  repository?: string
  context_msg?: string
}

export function logSystemError(
  error: Error | unknown,
  context?: SystemErrorContext
) {
  const errObj =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  log(
    createLogEntry<SystemLogEntry>({
      level: 'error',
      event_type: 'system_error',
      error_message: errObj.message,
      error_stack: errObj.stack,
      error_name: errObj.name,
      ...context
    })
  )
}

export function logSystemWarning(
  error: Error | unknown,
  context?: SystemErrorContext
) {
  const errObj =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  log(
    createLogEntry<SystemLogEntry>({
      level: 'warn',
      event_type: 'system_warn',
      error_message: errObj.message,
      error_stack: errObj.stack,
      error_name: errObj.name,
      ...context
    })
  )
}

export function logWebhookReceived(
  githubEvent: string,
  payload: any,
  isProcessed: boolean = false
) {
  // Extract common payload information safely
  const action = payload?.action
  const prNumber = payload?.pull_request?.number
  const repository = payload?.repository ? 
    `${payload.repository.owner?.login}/${payload.repository.name}` : undefined
  const senderLogin = payload?.sender?.login
  const senderType = payload?.sender?.type
  const payloadSize = JSON.stringify(payload).length

  log(
    createLogEntry<WebhookLogEntry>({
      level: 'info',
      event_type: 'webhook_received',
      github_event: githubEvent,
      action,
      pr_number: prNumber,
      repository,
      sender_login: senderLogin,
      sender_type: senderType,
      payload_size: payloadSize,
      is_processed: isProcessed
    })
  )
}
