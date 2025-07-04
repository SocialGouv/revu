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
}

interface SystemLogEntry extends BaseLogEntry {
  event_type: 'app_started' | 'reviewer_added' | 'system_error' | 'system_warn'
  pr_number?: number
  repository?: string
  error_message?: string
}

function createLogEntry<T extends ReviewLogEntry | SystemLogEntry>(
  partial: Omit<T, 'timestamp' | 'service'>
): T {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'revu' as const,
    ...partial
  }

  return entry as T
}

function log(entry: ReviewLogEntry | SystemLogEntry) {
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
  error: string
) {
  log(
    createLogEntry<ReviewLogEntry>({
      level: 'error',
      event_type: 'review_failed',
      pr_number: prNumber,
      repository,
      review_type: reviewType,
      error_message: error
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

export function logSystemError(
  message: string,
  context?: { pr_number?: number; repository?: string }
) {
  log(
    createLogEntry<SystemLogEntry>({
      level: 'error',
      event_type: 'system_error',
      error_message: message,
      ...context
    })
  )
}

export function logSystemWarning(
  message: string,
  context?: { pr_number?: number; repository?: string }
) {
  log(
    createLogEntry<SystemLogEntry>({
      level: 'warn',
      event_type: 'system_warn',
      error_message: message,
      ...context
    })
  )
}
