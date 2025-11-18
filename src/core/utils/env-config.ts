import type { RevuAppConfig } from '../../types/config.ts'

export interface EnvOverrideSpec<T extends Record<string, any>> {
  key: keyof T
  envVar: string
  parse?: (raw: string) => T[keyof T]
  validate?: (value: T[keyof T]) => boolean
  onInvalid?: (raw: string) => void
}

/**
 * Apply environment-variable-based overrides to a merged config object.
 *
 * Precedence (per key):
 * - If the file config explicitly set the key, keep it.
 * - Else, if the env var is present and valid, apply it on top of the merged config.
 */
export function applyEnvOverrides<T extends Record<string, any>>(
  merged: T,
  fileConfig: Partial<T>,
  specs: EnvOverrideSpec<T>[]
): T {
  for (const spec of specs) {
    const { key, envVar, parse, validate, onInvalid } = spec

    const envRaw = process.env[envVar]
    if (!envRaw) continue

    const hasExplicit =
      Object.prototype.hasOwnProperty.call(fileConfig, key) &&
      (fileConfig as any)[key] != null
    if (hasExplicit) continue

    let value: any
    try {
      value = parse ? parse(envRaw) : (envRaw as any)
    } catch {
      onInvalid?.(envRaw)
      continue
    }

    if (validate && !validate(value)) {
      onInvalid?.(envRaw)
      continue
    }

    ;(merged as any)[key] = value
  }

  return merged
}

// Convenience wrapper for app-level config overrides
export function applyRevuAppEnvOverrides(
  merged: RevuAppConfig,
  fileConfig: Partial<RevuAppConfig>,
  specs: EnvOverrideSpec<RevuAppConfig>[]
): RevuAppConfig {
  return applyEnvOverrides<RevuAppConfig>(merged, fileConfig, specs)
}
