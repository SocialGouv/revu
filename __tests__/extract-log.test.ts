import { describe, it, expect } from 'vitest'
import { extractLog } from '../src/extract-log.ts'
import * as path from 'path'
import * as os from 'os'

describe('extractLog', () => {
  it('should extract git log successfully', async () => {
    const result = await extractLog({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest',
      tempFolder: path.join(os.tmpdir(), 'carnets-log-test')
    })

    // Verify the result is a git log
    expect(result).toBeTruthy() // Should not be empty

    // Verify log format matches our specified format
    const logLines = result.split('\n')
    expect(logLines.length).toBeGreaterThan(0)

    // Each line should match our git log format: "%h - %an, %ar : %s"
    const logLineFormat = /^[a-f0-9]+ - .+, .+ ago : .+$/
    logLines.forEach((line) => {
      expect(line).toMatch(logLineFormat)
    })
  }, 30000) // Increase timeout to 30s since we're doing actual cloning
})
