import * as fs from 'fs/promises'
import ignore from 'ignore'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { PlatformClient } from './core/models/platform-types.ts'

/**
 * Creates an ignore instance from .revuignore content.
 * This is the preferred method for filtering files as it handles
 * all gitignore syntax including escape sequences and complex patterns.
 *
 * @param content - Content of the .revuignore file
 * @returns Ignore instance
 */
function createIgnoreInstance(content: string): ReturnType<typeof ignore> {
  const ig = ignore()
  ig.add(content)
  return ig
}

/**
 * Gets an ignore instance for a repository by fetching .revuignore from remote.
 * First tries to read .revuignore from the remote repository at the specified commit,
 * then falls back to the default .revuignore from this repo.
 * This is used when the repository hasn't been cloned locally yet.
 *
 * @param client - Platform client for fetching remote files
 * @param commitSha - Commit SHA to fetch the file from
 * @returns Ignore instance
 */
export async function getRemoteIgnoreInstance(
  client: PlatformClient,
  commitSha: string
): Promise<ReturnType<typeof ignore>> {
  let content = ''

  try {
    // Try to fetch .revuignore from the remote repository
    content = await client.getFileContent('.revuignore', commitSha)
  } catch {
    // Fall back to default .revuignore from this repo
    // Use import.meta.url to reliably find the project root
    const currentFileUrl = import.meta.url
    const currentFilePath = fileURLToPath(currentFileUrl)
    const srcDir = path.dirname(currentFilePath)
    const projectRoot = path.resolve(srcDir, '..')
    const defaultIgnorePath = path.join(projectRoot, '.revuignore')
    try {
      content = await fs.readFile(defaultIgnorePath, 'utf-8')
    } catch {
      // No ignore file found, return empty ignore instance
    }
  }

  return createIgnoreInstance(content)
}
