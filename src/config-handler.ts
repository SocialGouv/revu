import * as fs from 'fs/promises'
import * as yaml from 'js-yaml'
import * as path from 'path'
import { merge } from 'ts-deepmerge'
import type { PRValidationConfig } from './core/services/pr-validation-service.ts'
import { logSystemError } from './utils/logger.ts'
import {
  isBranchAllowed,
  normalizeBranch,
  type BranchFilterConfig
} from './core/utils/branch-filter.ts'

/**
 * Check if a file exists
 *
 * @param filePath - Path to the file to check
 * @returns True if the file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Interface for the complete Revu configuration
 */
interface RevuConfig {
  codingGuidelines: string[]
  validation: Partial<PRValidationConfig>
  branches?: BranchFilterConfig
}

/**
 * Default coding guidelines configuration
 */
const DEFAULT_CONFIG: RevuConfig = {
  codingGuidelines: [
    'Test coverage: Critical code requires 100% test coverage; non-critical paths require 60% coverage.',
    'Naming: Use semantically significant names for functions, classes, and parameters.',
    'Comments: Add comments only for complex code; simple code should be self-explanatory.',
    'Documentation: Public functions must have concise docstrings explaining purpose and return values.'
  ],
  validation: {}
}

/**
 * Reads the .revu.yml configuration file from the specified path
 *
 * @param configPath - Path to the .revu.yml configuration file
 * @returns The parsed configuration object
 */
export async function readConfig(
  configPath = path.join(process.cwd(), '.revu.yml')
): Promise<RevuConfig> {
  try {
    // Check if the config file exists
    const exists = await fileExists(configPath)
    if (!exists) {
      console.log('No .revu.yml configuration file found, using defaults')
      return DEFAULT_CONFIG
    }

    // Read and parse the YAML file
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config = yaml.load(configContent) as RevuConfig

    // Merge with default config to ensure all required fields exist
    // Use the default behavior (overwrite arrays)
    return merge(DEFAULT_CONFIG, config) as RevuConfig
  } catch (error) {
    logSystemError(error, {
      context_msg: 'Error reading .revu.yml configuration file'
    })

    return DEFAULT_CONFIG
  }
}

/**
 * Gets the default configuration
 *
 * @returns The default configuration object
 */
export function getDefaultConfig(): RevuConfig {
  return { ...DEFAULT_CONFIG }
}

/**
 * Gets the coding guidelines from the configuration
 *
 * @param config - The configuration object
 * @returns The coding guidelines as a formatted string
 */
export function formatCodingGuidelines(config: RevuConfig): string {
  if (
    !config.codingGuidelines ||
    !Array.isArray(config.codingGuidelines) ||
    config.codingGuidelines.length === 0
  ) {
    return 'No specific coding guidelines defined.'
  }

  return config.codingGuidelines
    .map((guideline, index) => `${index + 1}. ${guideline}`)
    .join('\n')
}

/**
 * Gets the coding guidelines from the configuration
 *
 * @param repoPath - Optional path to the repository
 * @returns The coding guidelines as a formatted string
 */
export async function getCodingGuidelines(repoPath?: string): Promise<string> {
  let configPath = path.join(process.cwd(), '.revu.yml')

  // If a repository path is provided, check for a .revu.yml file there
  if (repoPath) {
    const repoConfigPath = path.join(repoPath, '.revu.yml')
    const exists = await fileExists(repoConfigPath)
    if (exists) {
      configPath = repoConfigPath
    }
  }

  const config = await readConfig(configPath)
  return formatCodingGuidelines(config)
}

/**
 * Gets the PR validation configuration from the .revu.yml file
 *
 * @param repoPath - Optional path to the repository
 * @returns The PR validation configuration merged with defaults
 */
export async function getValidationConfig(
  repoPath?: string
): Promise<PRValidationConfig> {
  let configPath = path.join(process.cwd(), '.revu.yml')

  // If a repository path is provided, check for a .revu.yml file there
  if (repoPath) {
    const repoConfigPath = path.join(repoPath, '.revu.yml')
    const exists = await fileExists(repoConfigPath)
    if (exists) {
      configPath = repoConfigPath
    }
  }

  try {
    const config = await readConfig(configPath)

    // Import the default validation config dynamically to avoid circular dependency
    const { DEFAULT_VALIDATION_CONFIG } = await import(
      './core/services/pr-validation-service.ts'
    )

    // Merge user validation config with defaults
    if (config.validation) {
      return merge(
        DEFAULT_VALIDATION_CONFIG,
        config.validation
      ) as PRValidationConfig
    }

    return DEFAULT_VALIDATION_CONFIG
  } catch (error) {
    logSystemError(error, {
      context_msg: 'Error reading or parsing .revu.yml for validation config'
    })

    // Import default config as fallback
    const { DEFAULT_VALIDATION_CONFIG } = await import(
      './core/services/pr-validation-service.ts'
    )
    return DEFAULT_VALIDATION_CONFIG
  }
}

export async function getBranchesConfig(
  repoPath?: string
): Promise<BranchFilterConfig | undefined> {
  let configPath = path.join(process.cwd(), '.revu.yml')

  if (repoPath) {
    const repoConfigPath = path.join(repoPath, '.revu.yml')
    const exists = await fileExists(repoConfigPath)
    if (exists) {
      configPath = repoConfigPath
    }
  }

  try {
    const config = await readConfig(configPath)
    return config.branches
  } catch (error) {
    logSystemError(error, {
      context_msg: 'Error reading .revu.yml for branches config'
    })
    return undefined
  }
}

/**
 * Determine if a given branch should be processed based on .revu.yml "branches" rules.
 * Fail-open: on any error, returns allowed: true.
 */
export async function shouldProcessBranch(
  branch: string,
  repoPath?: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const cfg = await getBranchesConfig(repoPath)
    if (!cfg) {
      return { allowed: true }
    }
    const allowed = isBranchAllowed(branch, cfg)
    if (!allowed) {
      return {
        allowed: false,
        reason: `Branch "${normalizeBranch(branch)}" filtered by .revu.yml branches`
      }
    }
    return { allowed: true }
  } catch (error) {
    logSystemError(error, {
      context_msg: 'Error evaluating branches filter'
    })
    // Fail open on errors
    return { allowed: true }
  }
}
