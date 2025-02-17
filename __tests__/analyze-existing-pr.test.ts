import { sendToAnthropic } from '../src/send-to-anthropic.js'
import { describe, it, expect } from 'vitest'
import * as dotenv from 'dotenv'

dotenv.config()

describe('Analyze Existing PR', () => {
  it('should analyze PR and output results', async () => {
    // Example PR: https://github.com/SocialGouv/carnets/pull/468
    const repositoryUrl = 'https://github.com/SocialGouv/carnets.git'
    const branch = 'ai-digest'

    // Send to Anthropic and get analysis
    const analysis = await sendToAnthropic({
      repositoryUrl,
      branch
    })

    // Log the analysis
    console.log('PR Analysis Result:')
    console.log('==================')
    console.log(analysis)

    // Basic assertions
    expect(analysis).toBeDefined()
    expect(typeof analysis).toBe('string')
    expect(analysis.length).toBeGreaterThan(0)
  }, 60000) // Increase timeout to 60s for this test
})
