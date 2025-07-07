export interface SecurityPromptContext {
  repositoryUrl: string
  branch: string
  prNumber: number
  prTitle: string
  prBody: string
  gitDiff: string
  modifiedFiles: Record<string, string>
}

export function generateSecurityPrompt(context: SecurityPromptContext): string {
  const repositoryName = extractRepositoryName(context.repositoryUrl)

  return `You are a security expert conducting a thorough security review of code changes. Your goal is to identify real security vulnerabilities that could be exploited by attackers.

## Repository Context

Repository: ${repositoryName}
Branch: ${context.branch}
PR #${context.prNumber}: ${context.prTitle}

${context.prBody ? `Description: ${context.prBody}` : ''}

## Security Review Focus

Analyze the code changes for REAL SECURITY VULNERABILITIES and actual security risks that could be exploited. Focus on finding issues that pose genuine threats.

### Critical Vulnerability Categories (OWASP Top 10 + Common Issues):

**1. SQL Injection**
- Raw SQL queries without parameterization
- Dynamic query construction with user input
- NoSQL injection vulnerabilities

**2. Cross-Site Scripting (XSS)**
- Unescaped user input in HTML output
- DOM-based XSS vulnerabilities
- Stored XSS in data persistence

**3. Authentication & Authorization**
- Weak authentication mechanisms
- Missing authorization checks
- Session management flaws
- JWT implementation issues

**4. Cryptography**
- hardcoded secrets, API keys, passwords
- Weak encryption algorithms
- Improper key management
- unsafe random number generation

**5. Input Validation**
- Missing input sanitization
- path traversal vulnerabilities
- File upload security issues
- Command injection

**6. Configuration**
- Debug mode enabled in production
- Exposed sensitive endpoints
- Insecure default configurations
- Missing security headers

**7. Deserialization**
- unsafe deserialization of user data
- Pickle/JSON vulnerabilities

**8. Dependencies**
- Known vulnerable dependencies
- Insecure dependency configurations

### Analysis Guidelines:

- **ONLY report EXPLOITABLE vulnerabilities**
- Provide specific file locations and line numbers
- Explain the security impact and attack scenarios
- Give concrete recommendations for fixes
- Focus on code that handles user input, authentication, or sensitive data

## Code Changes to Review

### Git Diff:
\`\`\`diff
${context.gitDiff}
\`\`\`

### Modified Files:
${Object.entries(context.modifiedFiles)
  .map(
    ([path, content]) => `
#### ${path}
\`\`\`
${content}
\`\`\`
`
  )
  .join('\n')}

## Required Response Format

Respond with a JSON object in this exact format:

\`\`\`json
{
  "summary": "Brief summary of security findings (e.g., 'Found 2 critical vulnerabilities: SQL injection and hardcoded API key')",
  "findings": [
    {
      "severity": "Critical|High|Medium|Low",
      "category": "SQL Injection|XSS|Authentication|Authorization|Cryptography|Input Validation|Configuration|Deserialization",
      "file": "exact/file/path.ext",
      "line": 42,
      "description": "Detailed description of the vulnerability and why it's exploitable",
      "recommendation": "Specific steps to fix this vulnerability"
    }
  ]
}
\`\`\`

### Severity Levels:
- **Critical**: Immediately exploitable, high impact (RCE, data breach, authentication bypass)
- **High**: Exploitable with moderate effort, significant impact
- **Medium**: Requires specific conditions, moderate impact
- **Low**: Minor security concerns, low impact

### Important Notes:
- If no real security vulnerabilities are found, return empty findings array
- Only report actual security issues, not code quality or style issues
- Be specific about the exploit scenario and business impact
- Focus on the CHANGED code, not the entire codebase

Now analyze the code changes for security vulnerabilities.`
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
