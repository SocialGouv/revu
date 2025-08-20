import { type Context } from 'probot'
import { extractLineContent } from '../core/services/line-content-service.ts'

/**
 * Fetches the content of specific lines from a file
 * @param context GitHub context
 * @param filePath Path to the file
 * @param commitSha Commit SHA to fetch from
 * @param line End line number (1-indexed)
 * @param startLine Start line number (1-indexed), optional for single line
 * @returns The content of the specified lines
 */
export async function getLineContent(
  context: Context,
  filePath: string,
  commitSha: string,
  line: number,
  startLine?: number
): Promise<string> {
  try {
    const repo = context.repo()

    // Fetch file content from GitHub API
    const response = await context.octokit.rest.repos.getContent({
      ...repo,
      path: filePath,
      ref: commitSha
    })

    // Handle the response data
    const data = response.data
    if (!('content' in data) || !data.content) {
      return ''
    }

    // Decode base64 content
    const fileContent = Buffer.from(data.content, 'base64').toString('utf-8')

    // Use the shared line extraction logic
    return extractLineContent(fileContent, line, startLine)
  } catch (error) {
    console.warn(`Failed to fetch line content for ${filePath}:${line}:`, error)
    return ''
  }
}
