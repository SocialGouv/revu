import { getAppConfig } from './config-loader.ts'
import type { RevuAppConfig } from '../../types/config.ts'
import { logSystemWarning } from '../../utils/logger.ts'

export interface LlmRuntimeConfig {
  provider: 'anthropic' | 'openai'
  anthropic: {
    apiKey?: string
    model: string
    extendedContext: boolean
  }
  openai: {
    apiKey?: string
    model: string
    maxPromptChars: number
  }
}

export interface GithubAppRuntimeConfig {
  appId?: string
  privateKeyPath?: string
  privateKey?: string
  webhookSecret?: string
  webhookProxyUrl?: string
  proxyReviewerUsername?: string
  proxyReviewerToken?: string
}

export interface RedisRuntimeConfig {
  url?: string
  db?: number
  password?: string
  tls: boolean
  required: boolean
}

export interface RateLimitRuntimeConfig {
  repliesPerWindow: number
  windowSeconds: number
}

export interface DiscussionRuntimeConfig {
  maxFileContentChars: number
  lockTtlSeconds: number
  promptCache: {
    enabled: boolean
    ttlSeconds: number
    provider: 'anthropic' | 'auto'
    debug: boolean
  }
}

export interface SystemRuntimeConfig {
  host: string
  port: number
  gitPath: string
  authzFallbackToRepo: boolean
}

export interface RuntimeConfig {
  llm: LlmRuntimeConfig
  github: GithubAppRuntimeConfig
  redis: RedisRuntimeConfig
  rateLimit: RateLimitRuntimeConfig
  discussion: DiscussionRuntimeConfig
  system: SystemRuntimeConfig
}

let cachedRuntimeConfig: RuntimeConfig | null = null

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback
  const v = raw.toLowerCase()
  if (v === 'true') return true
  if (v === 'false') return false
  logSystemWarning(
    new Error('Invalid boolean env var, expected "true" or "false"'),
    { context_msg: `value="${raw}"` }
  )
  return fallback
}

function buildRuntimeConfig(app: RevuAppConfig): RuntimeConfig {
  // LLM / models
  const provider: 'anthropic' | 'openai' = app.llmProvider ?? 'anthropic'

  const anthropicModel =
    process.env.ANTHROPIC_MODEL ||
    app.anthropicModel ||
    'claude-sonnet-4-5-20250929'

  const openaiModel = process.env.OPENAI_MODEL || app.openaiModel || 'gpt-5'

  const anthropicExtendedContext = parseBooleanEnv(
    process.env.ANTHROPIC_EXTENDED_CONTEXT,
    app.anthropicExtendedContext ?? true
  )

  const maxOpenaiPromptChars = parseNumber(
    process.env.MAX_OPENAI_PROMPT_CHARS,
    app.maxOpenaiPromptChars ?? 120_000
  )

  // Prompt cache / discussion
  const enablePromptCache = parseBooleanEnv(
    process.env.ENABLE_PROMPT_CACHE,
    app.enablePromptCache ?? true
  )

  const promptCacheTtlSeconds = parseNumber(
    process.env.PROMPT_CACHE_TTL,
    app.promptCacheTtlSeconds ?? 172_800
  )

  const promptCacheProvider =
    (process.env.PROMPT_CACHE_PROVIDER as 'anthropic' | 'auto' | undefined) ||
    app.promptCacheProvider ||
    'auto'

  const promptCacheDebug = parseBooleanEnv(
    process.env.PROMPT_CACHE_DEBUG,
    app.promptCacheDebug ?? false
  )

  const maxFileContentChars = parseNumber(
    process.env.MAX_FILE_CONTENT_CHARS,
    app.maxFileContentChars ?? 50_000
  )

  const discussionLockTtlSeconds = parseNumber(
    process.env.DISCUSSION_LOCK_TTL_SECONDS,
    app.discussionLockTtlSeconds ?? 240
  )

  // Rate limiting
  const repliesPerWindow = parseNumber(
    process.env.REPLIES_PER_WINDOW,
    app.repliesPerWindow ?? 10
  )

  const rateWindowSeconds = parseNumber(
    process.env.RATE_WINDOW_SECONDS,
    app.rateWindowSeconds ?? 3_600
  )

  // Redis / compute cache
  const redisUrl = process.env.REDIS_URL || app.redisUrl

  const redisDb = (() => {
    const fromEnv = process.env.REDIS_DB
    if (fromEnv != null && !Number.isNaN(Number(fromEnv))) {
      return Number(fromEnv)
    }
    return app.redisDb
  })()

  const redisPassword = process.env.REDIS_PASSWORD || app.redisPassword

  const redisTls = parseBooleanEnv(process.env.REDIS_TLS, app.redisTls ?? false)

  const redisRequired = parseBooleanEnv(
    process.env.REDIS_REQUIRED,
    app.redisRequired ?? false
  )

  // GitHub & system
  const authzFallbackToRepo = parseBooleanEnv(
    process.env.AUTHZ_FALLBACK_TO_REPO,
    app.authzFallbackToRepo ?? false
  )

  const gitPath = process.env.GIT_PATH || app.gitPath || '/usr/bin/git'

  const host = process.env.HOST || app.host || '0.0.0.0'

  const port = parseNumber(process.env.PORT, app.port ?? 3000)

  // GitHub App & proxy secrets remain env-only but are surfaced via config
  const github: GithubAppRuntimeConfig = {
    appId: process.env.APP_ID,
    privateKeyPath: process.env.PRIVATE_KEY_PATH,
    privateKey: process.env.PRIVATE_KEY,
    webhookSecret: process.env.WEBHOOK_SECRET,
    webhookProxyUrl: process.env.WEBHOOK_PROXY_URL,
    proxyReviewerUsername: process.env.PROXY_REVIEWER_USERNAME,
    proxyReviewerToken: process.env.PROXY_REVIEWER_TOKEN
  }

  return {
    llm: {
      provider,
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: anthropicModel,
        extendedContext: anthropicExtendedContext
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: openaiModel,
        maxPromptChars: maxOpenaiPromptChars
      }
    },
    github,
    redis: {
      url: redisUrl,
      db: redisDb,
      password: redisPassword,
      tls: redisTls,
      required: redisRequired
    },
    rateLimit: {
      repliesPerWindow,
      windowSeconds: rateWindowSeconds
    },
    discussion: {
      maxFileContentChars,
      lockTtlSeconds: discussionLockTtlSeconds,
      promptCache: {
        enabled: enablePromptCache,
        ttlSeconds: promptCacheTtlSeconds,
        provider: promptCacheProvider,
        debug: promptCacheDebug
      }
    },
    system: {
      host,
      port,
      gitPath,
      authzFallbackToRepo
    }
  }
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedRuntimeConfig) return cachedRuntimeConfig

  const appConfig = await getAppConfig()
  cachedRuntimeConfig = buildRuntimeConfig(appConfig)
  return cachedRuntimeConfig
}

// Test helper to reset runtime config between test cases
export function _resetRuntimeConfigCacheForTests() {
  cachedRuntimeConfig = null
}
