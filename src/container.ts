import "reflect-metadata"
import { container } from 'tsyringe'
import type { WebhookApp } from './core/utils/platform.ts'
import { GithubWebhookApp } from './platforms/github/webhooks.ts'

const PROVIDER = process.env.CODE_HOSTING_PROVIDER || 'github' as 'github' | 'gitlab'

if (PROVIDER === 'github') {
  container.registerInstance<WebhookApp>('WebhookApp', await GithubWebhookApp.create())
} else if (PROVIDER === 'gitlab') {
  // container.register<WebhookApp>('WebhookApp', { useClass: GitlabWebhookApp })
  throw new Error('GitLab support is not yet implemented')
} else {
  throw new Error(`Unsupported CODE_HOSTING_PROVIDER: ${PROVIDER}`)
}

export { container }
