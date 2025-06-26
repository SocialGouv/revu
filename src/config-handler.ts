import * as fs from 'fs/promises'
import * as yaml from 'js-yaml'
import * as path from 'path'
import { merge } from 'ts-deepmerge'

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
 * Interface for the coding guidelines configuration
 */
export interface CodingGuidelinesConfig {
  codingGuidelines: string[]
  [key: string]: unknown // Allow for future configuration options
}

/**
 * Default coding guidelines configuration
 */
const DEFAULT_CONFIG: CodingGuidelinesConfig = {
  codingGuidelines: [
    'Test coverage: Critical code requires 100% test coverage; non-critical paths require 60% coverage.',
    'Naming: Use semantically significant names for functions, classes, and parameters.',
    'Comments: Add comments only for complex code; simple code should be self-explanatory.',
    'Documentation: Public functions must have concise docstrings explaining purpose and return values.'
  ]
}

/**
 * Reads the .revu.yml configuration file from the specified path
 *
 * @param configPath - Path to the .revu.yml configuration file
 * @returns The parsed configuration object
 */
export async function readConfig(
  configPath = path.join(process.cwd(), '.revu.yml')
): Promise<CodingGuidelinesConfig> {
  try {
    // Check if the config file exists
    const exists = await fileExists(configPath)
    if (!exists) {
      console.log('No .revu.yml configuration file found, using defaults')
      return DEFAULT_CONFIG
    }

    // Read and parse the YAML file
    const configContent = await fs.readFile(configPath, 'utf-8')
    const config = yaml.load(configContent) as CodingGuidelinesConfig

    // Merge with default config to ensure all required fields exist
    // Use the default behavior (overwrite arrays)
    return merge(DEFAULT_CONFIG, config) as CodingGuidelinesConfig
  } catch (error) {
    console.error('Error reading .revu.yml configuration file:', error)
    return DEFAULT_CONFIG
  }
}

/**
 * Gets the default configuration
 *
 * @returns The default configuration object
 */
export function getDefaultConfig(): CodingGuidelinesConfig {
  return { ...DEFAULT_CONFIG }
}

/**
 * Gets the coding guidelines from the configuration
 *
 * @param config - The configuration object
 * @returns The coding guidelines as a formatted string
 */
export function formatCodingGuidelines(config: CodingGuidelinesConfig): string {
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
