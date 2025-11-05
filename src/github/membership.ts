import type { Octokit } from '@octokit/rest'

/**
 * Checks if a user is a member of the specified GitHub organization.
 * Returns false on any 404 or permission error (fail-closed).
 */
export async function isUserOrgMember(
  octokit: Octokit,
  org: string,
  username: string
): Promise<boolean> {
  try {
    // 204 = member, 404 = not a member. Requires "Organization members: Read" permission.
    await octokit.rest.orgs.checkMembershipForUser({
      org,
      username
    })
    return true
  } catch {
    // Most likely 404 (not member) or insufficient permission
    return false
  }
}

/**
 * Fallback: Checks if a user has at least read/triage permissions on the repository.
 * This can be used when org membership checks are unavailable.
 */
export async function hasAtLeastReadPermission(
  octokit: Octokit | any,
  owner: string,
  repo: string,
  username: string
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username
    })
    const level = data?.permission
    // permission can be: 'admin' | 'write' | 'read' | 'maintain' | 'triage' | 'none'
    return (
      level === 'admin' ||
      level === 'write' ||
      level === 'maintain' ||
      level === 'triage' ||
      level === 'read'
    )
  } catch {
    return false
  }
}

/**
 * Determines if a user is allowed to trigger actions based on org membership or
 * repository collaborator permissions as a fallback.
 *
 * @param org Optional organization login. If provided, org membership is required.
 * @param fallbackToRepo If true, fallback to checking repo collaborator permissions.
 */
export async function isUserAllowedForRepo(
  octokit: Octokit | any,
  params: {
    org?: string
    owner: string
    repo: string
    username: string
    fallbackToRepo?: boolean
  }
): Promise<boolean> {
  const { org, owner, repo, username, fallbackToRepo = true } = params

  if (org) {
    const member = await isUserOrgMember(octokit, org, username)
    if (member) return true
    if (!fallbackToRepo) return false
  }

  return hasAtLeastReadPermission(octokit, owner, repo, username)
}
