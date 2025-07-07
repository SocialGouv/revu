export interface SecurityFinding {
  severity: 'Critical' | 'High' | 'Medium' | 'Low'
  category: string
  file: string
  line: number
  description: string
  recommendation: string
}

export interface SecurityAnalysis {
  summary: string
  findings: SecurityFinding[]
}

export function parseSecurityAnalysis(response: string): SecurityAnalysis {
  try {
    const parsed = JSON.parse(response)

    // Validate required fields
    if (!parsed.summary || parsed.findings === undefined) {
      throw new Error('Missing required fields')
    }

    // Validate findings structure
    if (!Array.isArray(parsed.findings)) {
      throw new Error('Findings must be an array')
    }

    for (const finding of parsed.findings) {
      if (
        !finding.severity ||
        !finding.category ||
        !finding.file ||
        finding.line === undefined ||
        !finding.description ||
        !finding.recommendation
      ) {
        throw new Error('Invalid finding structure')
      }
    }

    return {
      summary: parsed.summary,
      findings: parsed.findings
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON response')
    }
    throw error
  }
}
