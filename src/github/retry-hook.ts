import { withRetryOctokit } from '../utils/retry.ts'

type Ctx = {
  repository?: string
  pr_number?: number
}

/**
 * Globally attaches a p-retry wrapper to all Octokit requests for a given instance.
 * This reduces per-call verbosity by centralizing retry logic.
 *
 * Important: Do not also wrap individual calls with withRetryOctokit when using this,
 * to avoid double-wrapping and nested retries.
 */
type HasHook = {
  hook: {
    wrap: (
      name: string,
      wrapper: (request: any, options: any) => Promise<any>
    ) => void
  }
}

// Track instances that already have retry attached
const attachedInstances = new WeakSet<HasHook>()

export function attachOctokitRetry<T extends HasHook>(
  octokit: T,
  ctx?: Ctx
): T {
  // Avoid attaching twice
  if (attachedInstances.has(octokit)) {
    return octokit
  }

  attachedInstances.add(octokit)

  // Wrap the base request pipeline
  anyOcto.hook.wrap('request', async (request: any, options: any) => {
    const method = options?.method || 'REQUEST'
    const url = options?.url || ''
    const operation = `${method} ${url}`
    return withRetryOctokit(() => request(options), {
      context: {
        operation,
        repository: ctx?.repository,
        pr_number: ctx?.pr_number
      }
    })
  })

  return octokit
}
