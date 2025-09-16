import 'reflect-metadata'
import { container } from 'tsyringe'
import { PlatformService, type WebhookApp } from './platforms/index.ts'
import { GithubWebhookApp } from './platforms/github/webhooks.ts'

const PROVIDER =
  process.env.CODE_HOSTING_PROVIDER || ('github' as 'github' | 'gitlab')

if (PROVIDER === 'github') {
  const platformService = new PlatformService(
    process.env.PROXY_REVIEWER_USERNAME
  )
  container.registerInstance<WebhookApp>(
    'WebhookApp',
    await GithubWebhookApp.create(platformService)
  )
} else if (PROVIDER === 'gitlab') {
  // container.register<WebhookApp>('WebhookApp', { useClass: GitlabWebhookApp })
  throw new Error(
    'GitLab support is not yet implemented. Please implement GitlabWebhookApp class or set CODE_HOSTING_PROVIDER=github'
  )
} else {
  throw new Error(`Unsupported CODE_HOSTING_PROVIDER: ${PROVIDER}`)
}

export { container }
