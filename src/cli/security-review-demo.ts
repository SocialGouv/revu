#!/usr/bin/env node

import { parseSecurityAnalysis } from '../security/security-analysis-parser.ts'
import { logSecurityReport } from '../security/security-console-logger.ts'
import { generateSecurityPrompt } from '../prompts/security-prompt.ts'
import type { SecurityPromptContext } from '../prompts/security-prompt.ts'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log(`
Usage: yarn security-review-demo <repository-url> <pr-number> [branch]

Example:
  yarn security-review-demo https://github.com/owner/repo.git 123 feature/auth

This will perform a DEMO security review of PR #123 using simulated Claude responses.
`)
    process.exit(1)
  }

  const [repositoryUrl, prNumberStr, branch = 'main'] = args
  const prNumber = parseInt(prNumberStr, 10)

  if (isNaN(prNumber)) {
    console.error('❌ Invalid PR number. Please provide a valid number.')
    process.exit(1)
  }

  // Mock data with security vulnerabilities for demonstration
  const mockContext: SecurityPromptContext = {
    repositoryUrl,
    branch,
    prNumber,
    prTitle: 'Add authentication and user management',
    prBody:
      'This PR adds JWT authentication and user management features with database integration',
    gitDiff: `
@@ -1,5 +1,25 @@
 const express = require('express')
 const app = express()
 
+// Authentication middleware
+const jwt = require('jsonwebtoken')
+const SECRET_KEY = 'hardcoded-secret-key-123'
+
+app.use('/api', (req, res, next) => {
+  const token = req.headers.authorization
+  jwt.verify(token, SECRET_KEY, (err, decoded) => {
+    if (err) return res.status(401).json({ error: 'Unauthorized' })
+    req.user = decoded
+    next()
+  })
+})
+
 app.get('/users', (req, res) => {
-  res.json({ users: [] })
+  const query = "SELECT * FROM users WHERE id = " + req.query.id
+  db.query(query, (err, results) => {
+    if (err) throw err
+    res.json({ users: results })
+  })
 })
+
+app.get('/admin', (req, res) => {
+  const isAdmin = req.query.admin === 'true'
+  if (isAdmin) {
+    res.json({ secret: 'admin-panel-data' })
+  } else {
+    res.status(403).json({ error: 'Forbidden' })
+  }
+})
`,
    modifiedFiles: {
      'src/auth.ts': `
const jwt = require('jsonwebtoken')
const SECRET_KEY = 'hardcoded-secret-key-123'

export function generateToken(userId: string) {
  return jwt.sign({ userId }, SECRET_KEY, { expiresIn: '1h' })
}

export function verifyToken(token: string) {
  return jwt.verify(token, SECRET_KEY)
}
`,
      'src/database.ts': `
const mysql = require('mysql2')

export function getUserById(id: string) {
  const query = "SELECT * FROM users WHERE id = " + id
  return db.query(query)
}

export function searchUsers(searchTerm: string) {
  const query = \`SELECT * FROM users WHERE name LIKE '%\${searchTerm}%'\`
  return db.query(query)
}

export function deleteUser(id: string) {
  // No authorization check!
  const query = "DELETE FROM users WHERE id = " + id
  return db.query(query)
}
`,
      'src/api.ts': `
const express = require('express')
const { exec } = require('child_process')
const app = express()

app.get('/users/:id', (req, res) => {
  const userId = req.params.id
  const query = "SELECT * FROM users WHERE id = " + userId
  db.query(query, (err, results) => {
    if (err) throw err
    res.json({ user: results[0] })
  })
})

app.post('/search', (req, res) => {
  const { term } = req.body
  const query = \`SELECT * FROM users WHERE name LIKE '%\${term}%'\`
  db.query(query, (err, results) => {
    res.json({ users: results })
  })
})

app.get('/admin/logs', (req, res) => {
  const logFile = req.query.file || 'app.log'
  exec(\`cat /var/logs/\${logFile}\`, (err, stdout) => {
    res.send(stdout)
  })
})
`
    }
  }

  // Simulated Claude response with realistic security findings
  const mockClaudeResponse = `{
    "summary": "Found 6 critical security vulnerabilities including SQL injection, hardcoded secrets, and command injection",
    "findings": [
      {
        "severity": "Critical",
        "category": "Cryptography", 
        "file": "src/auth.ts",
        "line": 2,
        "description": "Hardcoded JWT secret key 'hardcoded-secret-key-123' in source code. This allows anyone with access to the code to forge tokens.",
        "recommendation": "Store secret keys in environment variables using process.env.JWT_SECRET and use a cryptographically secure random string"
      },
      {
        "severity": "Critical",
        "category": "SQL Injection",
        "file": "src/database.ts", 
        "line": 4,
        "description": "Raw SQL query construction with user input concatenation. User-provided 'id' parameter is directly concatenated into SQL query without sanitization.",
        "recommendation": "Use parameterized queries with placeholders: 'SELECT * FROM users WHERE id = ?' and pass parameters separately"
      },
      {
        "severity": "Critical", 
        "category": "SQL Injection",
        "file": "src/database.ts",
        "line": 9,
        "description": "Template literal SQL injection vulnerability. The searchTerm parameter is directly interpolated into SQL query allowing malicious SQL execution.",
        "recommendation": "Use parameterized queries instead of template literals for SQL construction"
      },
      {
        "severity": "Critical",
        "category": "Command Injection", 
        "file": "src/api.ts",
        "line": 25,
        "description": "Command injection vulnerability in exec() call. User-controlled 'file' parameter is directly interpolated into shell command, allowing arbitrary command execution.",
        "recommendation": "Validate and sanitize the file parameter against a whitelist of allowed filenames, or use fs.readFile() instead of exec()"
      },
      {
        "severity": "High",
        "category": "Authorization",
        "file": "src/database.ts", 
        "line": 14,
        "description": "Missing authorization check in deleteUser function. Any authenticated user can delete any user account without permission verification.",
        "recommendation": "Add authorization checks to verify the requesting user has permission to delete the target user account"
      },
      {
        "severity": "Medium",
        "category": "Authorization",
        "file": "src/api.ts",
        "line": 26,
        "description": "Authorization bypass through query parameter. Admin access is granted based on user-controlled query parameter without proper authentication.",
        "recommendation": "Implement proper role-based access control and verify admin privileges through authenticated user session, not query parameters"
      }
    ]
  }`

  console.log('🔐 Starting DEMO security review...')
  console.log(`Repository: ${repositoryUrl}`)
  console.log(`PR: #${prNumber}`)
  console.log(`Branch: ${branch}`)
  console.log('')

  console.log('📝 Generated security prompt:')
  const prompt = generateSecurityPrompt(mockContext)
  console.log(`Prompt length: ${prompt.length} characters`)
  console.log('')

  try {
    console.log('🤖 Simulating Claude API response...')

    // Parse the simulated response
    const analysis = parseSecurityAnalysis(mockClaudeResponse)

    // Extract repository name
    const repositoryName =
      repositoryUrl
        .match(/github\.com[/:](.*?)\/(.*?)(?:\.git)?$/)?.[0]
        ?.replace('github.com/', '') || repositoryUrl

    // Log the security report
    logSecurityReport(repositoryName, prNumber, analysis)

    console.log('\n✅ DEMO security review completed successfully!')
    console.log(`Found ${analysis.findings.length} security issue(s)`)

    if (analysis.findings.length > 0) {
      const criticalCount = analysis.findings.filter(
        (f) => f.severity === 'Critical'
      ).length
      const highCount = analysis.findings.filter(
        (f) => f.severity === 'High'
      ).length
      const mediumCount = analysis.findings.filter(
        (f) => f.severity === 'Medium'
      ).length
      const lowCount = analysis.findings.filter(
        (f) => f.severity === 'Low'
      ).length

      console.log(`\n📊 Severity breakdown:`)
      if (criticalCount > 0) console.log(`  🔴 Critical: ${criticalCount}`)
      if (highCount > 0) console.log(`  🟠 High: ${highCount}`)
      if (mediumCount > 0) console.log(`  🟡 Medium: ${mediumCount}`)
      if (lowCount > 0) console.log(`  🟢 Low: ${lowCount}`)

      console.log(`\n⚠️  CRITICAL SECURITY ISSUES FOUND!`)
      console.log(
        `This code should NOT be deployed to production without fixing these vulnerabilities.`
      )
    }
  } catch (error) {
    console.error('\n❌ Security review failed:')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)
