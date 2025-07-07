import { generateSecurityPrompt } from '../prompts/security-prompt.ts'
import type { SecurityPromptContext } from '../prompts/security-prompt.ts'
import { parseSecurityAnalysis } from './security-analysis-parser.ts'
import type { SecurityAnalysis } from './security-analysis-parser.ts'
import { logSecurityReport } from './security-console-logger.ts'
import { getSender } from '../anthropic-senders/index.ts'

export async function handleSecurityReview(
  context: SecurityPromptContext
): Promise<SecurityAnalysis> {
  const repositoryName = extractRepositoryName(context.repositoryUrl)

  try {
    // Step 1: Generate security-focused prompt
    const prompt = generateSecurityPrompt(context)

    // Step 2: Send prompt to Claude using default sender
    const sender = getSender('security-review')
    const claudeResponse = await sender(prompt)

    // Step 3: Parse Claude's response
    const analysis = parseSecurityAnalysis(claudeResponse)

    // Step 4: Log the security report to console
    logSecurityReport(repositoryName, context.prNumber, analysis)

    return analysis
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Create error analysis
    const errorAnalysis: SecurityAnalysis = {
      summary: getErrorSummary(error),
      findings: []
    }

    // Log error analysis
    logSecurityReport(repositoryName, context.prNumber, errorAnalysis)

    // Re-throw with context
    throw new Error(`Security review failed: ${errorMessage}`)
  }
}

function extractRepositoryName(repositoryUrl: string): string {
  if (!repositoryUrl) return 'unknown'

  try {
    // Extract from GitHub URL like https://github.com/owner/repo.git
    const match = repositoryUrl.match(/github\.com[/:](.*?)\/(.*?)(?:\.git)?$/)
    if (match) {
      return `${match[1]}/${match[2]}`
    }
    return repositoryUrl
  } catch {
    return repositoryUrl
  }
}

function getErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('JSON')) {
      return 'Security review failed due to response parsing error'
    }
    if (error.message.includes('API')) {
      return 'Security review failed due to API error'
    }
  }
  return 'Security review failed due to unknown error'
}
