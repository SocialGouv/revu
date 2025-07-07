#!/usr/bin/env node

import { handleSecurityReview } from '../security/security-handler.ts'
import type { SecurityPromptContext } from '../prompts/security-prompt.ts'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log(`
Usage: yarn security-review <repository-url> <pr-number> [branch]

Example:
  yarn security-review https://github.com/owner/repo.git 123 feature/auth

This will perform a security review of PR #123 and display results in the console.
`)
    process.exit(1)
  }

  const [repositoryUrl, prNumberStr, branch = 'main'] = args
  const prNumber = parseInt(prNumberStr, 10)

  if (isNaN(prNumber)) {
    console.error('❌ Invalid PR number. Please provide a valid number.')
    process.exit(1)
  }

  // Mock data for demonstration - in real usage, this would be extracted from GitHub
  const mockContext: SecurityPromptContext = {
    repositoryUrl,
    branch,
    prNumber,
    prTitle: 'Security Review Test',
    prBody: 'Testing the security review bot with sample code changes',
    gitDiff: `
@@ -1,5 +1,15 @@
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
`,
      'src/api.ts': `
const express = require('express')
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
`
    }
  }

  console.log('🔐 Starting security review...')
  console.log(`Repository: ${repositoryUrl}`)
  console.log(`PR: #${prNumber}`)
  console.log(`Branch: ${branch}`)
  console.log('')

  try {
    const analysis = await handleSecurityReview(mockContext)

    console.log('\n✅ Security review completed successfully!')
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
    }
  } catch (error) {
    console.error('\n❌ Security review failed:')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)
