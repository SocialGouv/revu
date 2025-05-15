import type { Octokit } from '@octokit/rest'
import { type Context } from 'probot'

/**
 * Creates a minimal context object compatible with the comment handlers
 * for use in the CLI tool.
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param octokit Octokit instance
 * @returns A minimal context object compatible with the comment handlers
 */
export async function createMinimalContext(
  owner: string,
  repo: string,
  octokit: Octokit
): Promise<Context> {
  // Create a minimal context object compatible with the comment handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const minimalContext: any = {
    repo: () => ({ owner, repo }),
    octokit: octokit,
    log: console,
    // Add minimal required properties
    name: 'revu-cli',
    id: 1,
    payload: {}
  }

  return minimalContext as Context
}
