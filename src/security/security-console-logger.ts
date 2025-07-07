import type {
  SecurityAnalysis,
  SecurityFinding
} from './security-analysis-parser.ts'

export function formatSecurityReport(
  repository: string,
  prNumber: number,
  analysis: SecurityAnalysis
): string {
  const lines = []

  lines.push('=== RAPPORT DE SÉCURITÉ ===')
  lines.push(`Repository: ${repository}`)
  lines.push(`PR: #${prNumber}`)
  lines.push('')
  lines.push(`Résumé: ${analysis.summary}`)
  lines.push('')

  if (analysis.findings.length === 0) {
    lines.push('✅ Aucune vulnérabilité détectée')
  } else {
    lines.push('🔍 Vulnérabilités détectées:')
    lines.push('')

    // Group findings by severity
    const severityOrder = ['Critical', 'High', 'Medium', 'Low'] as const
    const groupedFindings = groupFindingsBySeverity(analysis.findings)

    for (const severity of severityOrder) {
      const findings = groupedFindings[severity]
      if (findings && findings.length > 0) {
        for (const finding of findings) {
          lines.push(
            `[${severity.toUpperCase()}] ${finding.category} in ${finding.file}:${finding.line}`
          )
          lines.push(`  📝 ${finding.description}`)
          lines.push(`  💡 ${finding.recommendation}`)
          lines.push('')
        }
      }
    }
  }

  lines.push('========================')

  return lines.join('\n')
}

export function logSecurityReport(
  repository: string,
  prNumber: number,
  analysis: SecurityAnalysis
): void {
  const report = formatSecurityReport(repository, prNumber, analysis)
  console.log(report)
}

function groupFindingsBySeverity(
  findings: SecurityFinding[]
): Record<string, SecurityFinding[]> {
  const grouped: Record<string, SecurityFinding[]> = {}

  for (const finding of findings) {
    if (!grouped[finding.severity]) {
      grouped[finding.severity] = []
    }
    grouped[finding.severity].push(finding)
  }

  return grouped
}
