import { describe, expect, it } from 'vitest'
import { parseSecurityAnalysis } from '../../src/security/security-analysis-parser.ts'

describe('SecurityAnalysisParser', () => {
  describe('parseSecurityAnalysis', () => {
    it('should parse valid Claude security response', () => {
      const mockResponse = `{
        "summary": "Found 3 security vulnerabilities",
        "findings": [
          {
            "severity": "Critical",
            "category": "SQL Injection",
            "file": "src/db.ts",
            "line": 42,
            "description": "Raw SQL query without parameterization",
            "recommendation": "Use parameterized queries"
          },
          {
            "severity": "High",
            "category": "XSS",
            "file": "src/components/UserInput.tsx",
            "line": 15,
            "description": "User input rendered without sanitization",
            "recommendation": "Sanitize input before rendering"
          }
        ]
      }`

      const parsed = parseSecurityAnalysis(mockResponse)

      expect(parsed.summary).toBe('Found 3 security vulnerabilities')
      expect(parsed.findings).toHaveLength(2)
      expect(parsed.findings[0].severity).toBe('Critical')
      expect(parsed.findings[0].category).toBe('SQL Injection')
      expect(parsed.findings[1].severity).toBe('High')
      expect(parsed.findings[1].category).toBe('XSS')
    })

    it('should handle empty findings array', () => {
      const mockResponse = `{
        "summary": "No security vulnerabilities found",
        "findings": []
      }`

      const parsed = parseSecurityAnalysis(mockResponse)

      expect(parsed.summary).toBe('No security vulnerabilities found')
      expect(parsed.findings).toHaveLength(0)
    })

    it('should throw error for invalid JSON', () => {
      const invalidResponse = 'This is not JSON'

      expect(() => parseSecurityAnalysis(invalidResponse)).toThrow(
        'Invalid JSON response'
      )
    })

    it('should throw error for missing required fields', () => {
      const incompleteResponse = `{
        "summary": "Test summary"
      }`

      expect(() => parseSecurityAnalysis(incompleteResponse)).toThrow(
        'Missing required fields'
      )
    })

    it('should validate finding structure', () => {
      const responseWithInvalidFinding = `{
        "summary": "Test summary",
        "findings": [
          {
            "severity": "Critical"
          }
        ]
      }`

      expect(() => parseSecurityAnalysis(responseWithInvalidFinding)).toThrow(
        'Invalid finding structure'
      )
    })

    it('should handle different severity levels', () => {
      const mockResponse = `{
        "summary": "Mixed severity findings",
        "findings": [
          {
            "severity": "Critical",
            "category": "Authentication",
            "file": "src/auth.ts",
            "line": 10,
            "description": "Test",
            "recommendation": "Test"
          },
          {
            "severity": "High",
            "category": "Authorization",
            "file": "src/auth.ts",
            "line": 20,
            "description": "Test",
            "recommendation": "Test"
          },
          {
            "severity": "Medium",
            "category": "Input Validation",
            "file": "src/input.ts",
            "line": 30,
            "description": "Test",
            "recommendation": "Test"
          },
          {
            "severity": "Low",
            "category": "Configuration",
            "file": "src/config.ts",
            "line": 40,
            "description": "Test",
            "recommendation": "Test"
          }
        ]
      }`

      const parsed = parseSecurityAnalysis(mockResponse)

      expect(parsed.findings).toHaveLength(4)
      expect(parsed.findings[0].severity).toBe('Critical')
      expect(parsed.findings[1].severity).toBe('High')
      expect(parsed.findings[2].severity).toBe('Medium')
      expect(parsed.findings[3].severity).toBe('Low')
    })
  })
})
