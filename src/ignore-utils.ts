import * as fs from 'fs/promises'
import ignore from 'ignore'
import * as path from 'path'

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
 * Gets an ignore instance for a repository.
 * First tries to read .revuignore from the target repository,
 * then falls back to the default .revuignore from this repo.
 * This is the preferred method for filtering files.
 *
 * @param repoPath - Path to the repository being reviewed
 * @returns Ignore instance
 */
export async function getIgnoreInstance(
  repoPath: string
): Promise<ReturnType<typeof ignore>> {
  // Try to read .revuignore from the target repository
  const repoIgnorePath = path.join(repoPath, '.revuignore')
  let content = ''

  try {
    content = await fs.readFile(repoIgnorePath, 'utf-8')
  } catch {
    // Fall back to default .revuignore from this repo
    const defaultIgnorePath = path.join(process.cwd(), '.revuignore')
    try {
      content = await fs.readFile(defaultIgnorePath, 'utf-8')
    } catch {
      // No ignore file found, return empty ignore instance
    }
  }

  return createIgnoreInstance(content)
}
