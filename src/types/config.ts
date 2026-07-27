/**
 * Configuration interface for the Revu application
 *
 * This represents app-level configuration that can be provided via
 * a local `config.json` file. Most of these fields have equivalent
 * environment variables, with the following precedence per key:
 *
 * 1. Built-in default (in DEFAULT_APP_CONFIG)
 * 2. Value from config.json (RevuAppConfig)
 * 3. Environment variable override (for non-secret knobs)
 *
 * Secrets (API keys, tokens, etc.) remain environment-only.
 */
export interface RevuAppConfig {
  /**
   * The prompt strategy to use for code review
   */
  promptStrategy: string

  /**
   * Whether to enable Anthropic's extended thinking capabilities
   * (may also be controlled per-repository via .revu.yml)
   */
  thinkingEnabled?: boolean

  /**
   * LLM provider to use for analysis
   * Defaults to "anthropic".
   *
   * This can also be controlled via the LLM_PROVIDER environment variable.
   */
  llmProvider?: 'anthropic' | 'openai'

  // === LLM / Model configuration (parity with env) ===

  /**
   * Default Anthropic model name.
   * Env equivalent: ANTHROPIC_MODEL (default: "claude-sonnet-4-5-20250929").
   */
  anthropicModel?: string

  /**
   * Whether to enable Anthropic extended context (1M token window).
   * Env equivalent: ANTHROPIC_EXTENDED_CONTEXT ("true"/"false").
   */
  anthropicExtendedContext?: boolean

  /**
   * Default OpenAI model name.
   * Env equivalent: OPENAI_MODEL (default: "gpt-5").
   */
  openaiModel?: string

  /**
   * Maximum characters allowed in the OpenAI prompt.
   * Env equivalent: MAX_OPENAI_PROMPT_CHARS (default: 120_000).
   */
  maxOpenaiPromptChars?: number

  // === Prompt cache / discussion behaviour ===

  /**
   * Enable provider-side prompt caching (best-effort).
   * Env equivalent: ENABLE_PROMPT_CACHE (default: true, disabled when "false").
   */
  enablePromptCache?: boolean

  /**
   * Prompt cache TTL in seconds.
   * Env equivalent: PROMPT_CACHE_TTL (default: 172800 = 2 days).
   */
  promptCacheTtlSeconds?: number

  /**
   * Provider selector for prompt cache hints.
   * Env equivalent: PROMPT_CACHE_PROVIDER (default: "auto").
   */
  promptCacheProvider?: 'anthropic' | 'auto'

  /**
   * Enable verbose prompt cache debug logging.
   * Env equivalent: PROMPT_CACHE_DEBUG (default: false).
   */
  promptCacheDebug?: boolean

  /**
   * Maximum number of characters of file content to include per file.
   * Env equivalent: MAX_FILE_CONTENT_CHARS (default: 50_000).
   */
  maxFileContentChars?: number

  /**
   * Lock TTL for discussion processing, in seconds.
   * Env equivalent: DISCUSSION_LOCK_TTL_SECONDS (default: 240).
   */
  discussionLockTtlSeconds?: number

  // === Rate limiting configuration ===

  /**
   * Maximum number of discussion replies allowed per user per PR
   * within the rate-limit window.
   * Env equivalent: REPLIES_PER_WINDOW (default: 10).
   */
  repliesPerWindow?: number

  /**
   * Length of the rate limit window in seconds.
   * Env equivalent: RATE_WINDOW_SECONDS (default: 3600).
   */
  rateWindowSeconds?: number

  // === Redis / compute cache configuration ===

  /**
   * Redis / Valkey connection URL.
   * Env equivalent: REDIS_URL.
   */
  redisUrl?: string

  /**
   * Redis DB index.
   * Env equivalent: REDIS_DB (default: 0 when URL is set).
   */
  redisDb?: number

  /**
   * Redis password (if your instance requires auth).
   * Env equivalent: REDIS_PASSWORD.
   */
  redisPassword?: string

  /**
   * Whether to use TLS when connecting to Redis.
   * Env equivalent: REDIS_TLS ("true"/"false").
   */
  redisTls?: boolean

  /**
   * Whether Redis is required for the app to function.
   * Env equivalent: REDIS_REQUIRED ("true"/"false", default: false).
   */
  redisRequired?: boolean

  // === GitHub authorization & system paths ===

  /**
   * If true, when org membership checks aren't available the app will
   * fallback to repo collaborator permissions.
   * Env equivalent: AUTHZ_FALLBACK_TO_REPO ("true"/"false").
   */
  authzFallbackToRepo?: boolean

  /**
   * Full path to the git executable.
   * Env equivalent: GIT_PATH (default: "/usr/bin/git").
   */
  gitPath?: string

  /**
   * Host for the HTTP server.
   * Env equivalent: HOST (default: "0.0.0.0").
   */
  host?: string

  /**
   * Port for the HTTP server.
   * Env equivalent: PORT (default: 3000).
   */
  port?: number
}

/**
 * Default configuration values.
 *
 * These represent the built-in baseline behavior when neither config.json
 * nor environment variables override a given setting.
 */
export const DEFAULT_APP_CONFIG: RevuAppConfig = {
  promptStrategy: 'line-comments',
  thinkingEnabled: false,
  llmProvider: 'anthropic',

  // LLM / model defaults
  anthropicModel: 'claude-sonnet-4-5-20250929',
  anthropicExtendedContext: true,
  openaiModel: 'gpt-5',
  maxOpenaiPromptChars: 120_000,

  // Prompt cache / discussion defaults
  enablePromptCache: true,
  promptCacheTtlSeconds: 172_800,
  promptCacheProvider: 'auto',
  promptCacheDebug: false,
  maxFileContentChars: 50_000,
  discussionLockTtlSeconds: 240,

  // Rate limiting defaults
  repliesPerWindow: 10,
  rateWindowSeconds: 3_600,

  // Redis defaults (disabled / optional by default)
  redisUrl: undefined,
  redisDb: undefined,
  redisPassword: undefined,
  redisTls: false,
  redisRequired: false,

  // GitHub authz & system defaults
  authzFallbackToRepo: false,
  gitPath: '/usr/bin/git',
  host: '0.0.0.0',
  port: 3000
}
