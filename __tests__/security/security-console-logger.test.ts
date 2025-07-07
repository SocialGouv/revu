import { describe, expect, it, vi } from 'vitest'
import {
  formatSecurityReport,
  logSecurityReport
} from '../../src/security/security-console-logger.ts'
import type { SecurityAnalysis } from '../../src/security/security-analysis-parser.ts'

describe('SecurityConsoleLogger', () => {
  describe('formatSecurityReport', () => {
    it('should format security report with findings for console output', () => {
      const mockAnalysis: SecurityAnalysis = {
        summary: 'Found 2 security vulnerabilities',
        findings: [
          {
            severity: 'Critical',
            category: 'SQL Injection',
            file: 'src/db.ts',
            line: 42,
            description: 'Raw SQL query without parameterization',
            recommendation: 'Use parameterized queries'
          },
          {
            severity: 'High',
            category: 'XSS',
            file: 'src/components/UserInput.tsx',
            line: 15,
            description: 'User input rendered without sanitization',
            recommendation: 'Sanitize input before rendering'
          }
        ]
      }

      const output = formatSecurityReport('test/repo', 123, mockAnalysis)

      expect(output).toContain('=== RAPPORT DE SÉCURITÉ ===')
      expect(output).toContain('Repository: test/repo')
      expect(output).toContain('PR: #123')
      expect(output).toContain('Found 2 security vulnerabilities')
      expect(output).toContain('[CRITICAL] SQL Injection in src/db.ts:42')
      expect(output).toContain('[HIGH] XSS in src/components/UserInput.tsx:15')
      expect(output).toContain('Raw SQL query without parameterization')
      expect(output).toContain('Use parameterized queries')
      expect(output).toContain('========================')
    })

    it('should format report with no findings', () => {
      const mockAnalysis: SecurityAnalysis = {
        summary: 'No security vulnerabilities found',
        findings: []
      }

      const output = formatSecurityReport('test/repo', 123, mockAnalysis)

      expect(output).toContain('=== RAPPORT DE SÉCURITÉ ===')
      expect(output).toContain('Repository: test/repo')
      expect(output).toContain('PR: #123')
      expect(output).toContain('No security vulnerabilities found')
      expect(output).toContain('Aucune vulnérabilité détectée')
      expect(output).toContain('========================')
    })

    it('should handle different severity levels with proper formatting', () => {
      const mockAnalysis: SecurityAnalysis = {
        summary: 'Mixed severity findings',
        findings: [
          {
            severity: 'Critical',
            category: 'Authentication',
            file: 'src/auth.ts',
            line: 10,
            description: 'Test critical',
            recommendation: 'Fix critical'
          },
          {
            severity: 'High',
            category: 'Authorization',
            file: 'src/auth.ts',
            line: 20,
            description: 'Test high',
            recommendation: 'Fix high'
          },
          {
            severity: 'Medium',
            category: 'Input Validation',
            file: 'src/input.ts',
            line: 30,
            description: 'Test medium',
            recommendation: 'Fix medium'
          },
          {
            severity: 'Low',
            category: 'Configuration',
            file: 'src/config.ts',
            line: 40,
            description: 'Test low',
            recommendation: 'Fix low'
          }
        ]
      }

      const output = formatSecurityReport('test/repo', 456, mockAnalysis)

      expect(output).toContain('[CRITICAL]')
      expect(output).toContain('[HIGH]')
      expect(output).toContain('[MEDIUM]')
      expect(output).toContain('[LOW]')
    })

    it('should include finding details and recommendations', () => {
      const mockAnalysis: SecurityAnalysis = {
        summary: 'One finding',
        findings: [
          {
            severity: 'High',
            category: 'XSS',
            file: 'src/components/Form.tsx',
            line: 25,
            description:
              'User input directly inserted into DOM without sanitization',
            recommendation:
              "Use React's built-in XSS protection or sanitize with DOMPurify"
          }
        ]
      }

      const output = formatSecurityReport('my/project', 789, mockAnalysis)

      expect(output).toContain(
        'User input directly inserted into DOM without sanitization'
      )
      expect(output).toContain(
        "Use React's built-in XSS protection or sanitize with DOMPurify"
      )
    })

    it('should group findings by severity level', () => {
      const mockAnalysis: SecurityAnalysis = {
        summary: 'Multiple findings of same severity',
        findings: [
          {
            severity: 'Critical',
            category: 'SQL Injection',
            file: 'src/db1.ts',
            line: 10,
            description: 'First critical',
            recommendation: 'Fix first'
          },
          {
            severity: 'Critical',
            category: 'Authentication',
            file: 'src/auth.ts',
            line: 20,
            description: 'Second critical',
            recommendation: 'Fix second'
          },
          {
            severity: 'Medium',
            category: 'Validation',
            file: 'src/input.ts',
            line: 30,
            description: 'Medium issue',
            recommendation: 'Fix medium'
          }
        ]
      }

      const output = formatSecurityReport('test/repo', 100, mockAnalysis)

      // Should have Critical section first, then Medium
      const criticalIndex = output.indexOf('[CRITICAL]')
      const mediumIndex = output.indexOf('[MEDIUM]')
      expect(criticalIndex).toBeLessThan(mediumIndex)
      expect(output.match(/\[CRITICAL\]/g)).toHaveLength(2)
      expect(output.match(/\[MEDIUM\]/g)).toHaveLength(1)
    })
  })

  describe('logSecurityReport', () => {
    it('should log formatted report to console', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const mockAnalysis: SecurityAnalysis = {
        summary: 'Test summary',
        findings: []
      }

      logSecurityReport('test/repo', 123, mockAnalysis)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('=== RAPPORT DE SÉCURITÉ ===')
      )

      consoleSpy.mockRestore()
    })
  })
})
