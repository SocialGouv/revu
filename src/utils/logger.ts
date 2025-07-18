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
  error_stack?: string
  error_name?: string
}

interface LLMLogEntry extends BaseLogEntry {
  event_type:
    | 'llm_request_sent'
    | 'llm_response_received'
    | 'llm_request_failed'
  pr_number?: number
  repository?: string
  model_used: string
  strategy_name: string
  request_duration_ms?: number
  tokens_used?: {
    input: number
    output: number
  }
  prompt_preview?: string
  response_preview?: string
  full_prompt?: string
  full_response?: string
  error_message?: string
}

function createLogEntry<
  T extends ReviewLogEntry | SystemLogEntry | LLMLogEntry
>(partial: Omit<T, 'timestamp' | 'service'>): T {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'revu' as const,
    ...partial
  }

  return entry as T
}

function log(entry: ReviewLogEntry | SystemLogEntry | LLMLogEntry) {
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

// LLM logging configuration
type LLMLogLevel = 'disabled' | 'metadata' | 'truncated' | 'full'

const CONTENT_TRUNCATE_LENGTH = 500

/**
 * Gets the current LLM log level from environment variables
 */
function getLLMLogLevel(): LLMLogLevel {
  return (process.env.LOG_LLM_EXCHANGES as LLMLogLevel) || 'metadata'
}

interface LLMLogContext {
  pr_number?: number
  repository?: string
}

/**
 * Truncates content to preview length with ellipsis
 */
function truncateContent(
  content: string,
  maxLength: number = CONTENT_TRUNCATE_LENGTH
): string {
  if (content.length <= maxLength) return content
  return content.substring(0, maxLength) + '...'
}

/**
 * Logs LLM request being sent
 */
export function logLLMRequestSent(
  prompt: string,
  model: string,
  strategyName: string,
  context?: LLMLogContext
) {
  const logLevel = getLLMLogLevel()
  if (logLevel === 'disabled') return

  const baseEntry = {
    level: 'info' as const,
    event_type: 'llm_request_sent' as const,
    model_used: model,
    strategy_name: strategyName,
    ...context
  }

  let entry: Omit<LLMLogEntry, 'timestamp' | 'service'>

  switch (logLevel) {
    case 'metadata':
      entry = baseEntry
      break
    case 'truncated':
      entry = {
        ...baseEntry,
        prompt_preview: truncateContent(prompt)
      }
      break
    case 'full':
      entry = {
        ...baseEntry,
        full_prompt: prompt,
        prompt_preview: truncateContent(prompt)
      }
      break
    default:
      entry = baseEntry
  }

  log(createLogEntry<LLMLogEntry>(entry))
}

/**
 * Logs LLM response received
 */
export function logLLMResponseReceived(
  response: string,
  model: string,
  strategyName: string,
  durationMs: number,
  tokensUsed?: { input: number; output: number },
  context?: LLMLogContext
) {
  const logLevel = getLLMLogLevel()
  if (logLevel === 'disabled') return

  const baseEntry = {
    level: 'info' as const,
    event_type: 'llm_response_received' as const,
    model_used: model,
    strategy_name: strategyName,
    request_duration_ms: durationMs,
    tokens_used: tokensUsed,
    ...context
  }

  let entry: Omit<LLMLogEntry, 'timestamp' | 'service'>

  switch (logLevel) {
    case 'metadata':
      entry = baseEntry
      break
    case 'truncated':
      entry = {
        ...baseEntry,
        response_preview: truncateContent(response)
      }
      break
    case 'full':
      entry = {
        ...baseEntry,
        full_response: response,
        response_preview: truncateContent(response)
      }
      break
    default:
      entry = baseEntry
  }

  log(createLogEntry<LLMLogEntry>(entry))
}

/**
 * Logs LLM request failure
 */
export function logLLMRequestFailed(
  error: Error | unknown,
  model: string,
  strategyName: string,
  context?: LLMLogContext
) {
  const logLevel = getLLMLogLevel()
  if (logLevel === 'disabled') return

  const errObj =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))

  log(
    createLogEntry<LLMLogEntry>({
      level: 'error',
      event_type: 'llm_request_failed',
      model_used: model,
      strategy_name: strategyName,
      error_message: errObj.message,
      ...context
    })
  )
}
