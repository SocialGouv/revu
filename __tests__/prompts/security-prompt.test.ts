import { describe, expect, it } from 'vitest'
import { generateSecurityPrompt } from '../../src/prompts/security-prompt.ts'

describe('SecurityPrompt', () => {
  describe('generateSecurityPrompt', () => {
    const mockContext = {
      repositoryUrl: 'https://github.com/test/repo.git',
      branch: 'feature/test',
      prNumber: 123,
      prTitle: 'Add user authentication',
      prBody: 'This PR adds JWT authentication to the API',
      gitDiff: `
@@ -1,5 +1,10 @@
 const express = require('express')
 const app = express()
 
+const jwt = require('jsonwebtoken')
+const SECRET_KEY = 'hardcoded-secret-123'
+
 app.get('/users', (req, res) => {
-  res.json({ users: [] })
+  const query = "SELECT * FROM users WHERE id = " + req.query.id
+  res.json({ users: query })
 })
`,
      modifiedFiles: {
        'src/auth.ts': `
const jwt = require('jsonwebtoken')
const SECRET_KEY = 'hardcoded-secret-123'

export function generateToken(userId: string) {
  return jwt.sign({ userId }, SECRET_KEY)
}
`,
        'src/api.ts': `
const express = require('express')
const app = express()

app.get('/users', (req, res) => {
  const query = "SELECT * FROM users WHERE id = " + req.query.id
  res.json({ users: query })
})
`
      }
    }

    it('should include security-focused instructions', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('security review')
      expect(prompt).toContain('vulnerabilities')
      expect(prompt).toContain('SQL injection')
      expect(prompt).toContain('XSS')
      expect(prompt).toContain('authentication')
      expect(prompt).toContain('authorization')
    })

    it('should include common vulnerability categories', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('SQL Injection')
      expect(prompt).toContain('Cross-Site Scripting')
      expect(prompt).toContain('Authentication')
      expect(prompt).toContain('Authorization')
      expect(prompt).toContain('Input Validation')
      expect(prompt).toContain('Cryptography')
      expect(prompt).toContain('Configuration')
    })

    it('should include context information', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('test/repo')
      expect(prompt).toContain('feature/test')
      expect(prompt).toContain('Add user authentication')
      expect(prompt).toContain('hardcoded-secret-123')
      expect(prompt).toContain('SELECT * FROM users')
    })

    it('should specify JSON response format', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('JSON')
      expect(prompt).toContain('"summary"')
      expect(prompt).toContain('"findings"')
      expect(prompt).toContain('"severity"')
      expect(prompt).toContain('"category"')
      expect(prompt).toContain('"file"')
      expect(prompt).toContain('"line"')
      expect(prompt).toContain('"description"')
      expect(prompt).toContain('"recommendation"')
    })

    it('should include severity levels', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('Critical')
      expect(prompt).toContain('High')
      expect(prompt).toContain('Medium')
      expect(prompt).toContain('Low')
    })

    it('should include OWASP references', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('OWASP')
    })

    it('should emphasize finding real vulnerabilities', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('real security vulnerabilities')
      expect(prompt).toContain('actual security risks')
      expect(prompt).toContain('exploitable')
    })

    it('should include examples of what to look for', () => {
      const prompt = generateSecurityPrompt(mockContext)

      expect(prompt).toContain('hardcoded secrets')
      expect(prompt).toContain('API keys')
      expect(prompt).toContain('passwords')
      expect(prompt).toContain('unsafe deserialization')
      expect(prompt).toContain('path traversal')
    })

    it('should handle empty context gracefully', () => {
      const emptyContext = {
        repositoryUrl: '',
        branch: '',
        prNumber: 0,
        prTitle: '',
        prBody: '',
        gitDiff: '',
        modifiedFiles: {}
      }

      const prompt = generateSecurityPrompt(emptyContext)

      expect(prompt).toContain('security review')
      expect(prompt).toContain('vulnerabilities')
    })
  })
})
