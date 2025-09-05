import type { Octokit } from '@octokit/rest'
import { type Context } from 'probot'

/**
 * Creates a minimal context object compatible with the comment handlers
 * for use in the CLI tool.
 *
 * NOTE: This function accepts an Octokit instance as a parameter because
 * the CLI tool doesn't have a Probot context available. The CLI creates
 * its own authenticated Octokit instance and passes it here to create
 * a minimal context that's compatible with the comment handlers.
 *
 * @param owner Repository owner
 * @param repo Repository name
 * @param octokit Octokit instance (created by CLI with GitHub App auth)
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
