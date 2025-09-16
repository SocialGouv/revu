import type { WebhookEvents } from '@octokit/webhooks/types'
import { config } from 'dotenv'
import { Router } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, createNodeMiddleware, createProbot, Probot } from 'probot'
import { injectable } from 'tsyringe'
import { logAppStarted, logInfo } from '../../utils/logger.ts'
import type { PlatformService, WebhookApp } from '../index.ts'
import GithubStore from './store.ts'

// Load environment variables
config()

@injectable()
export class GithubWebhookApp implements WebhookApp {
  public readonly router: Router
  private platformService: PlatformService

  constructor(
    middleware: (
      request: IncomingMessage,
      response: ServerResponse,
      next?: (err?: Error) => void
    ) => boolean | void | Promise<void | boolean>,
    platformService?: PlatformService
  ) {
    this.platformService = platformService
    const r = Router()
    r.use(middleware)
    this.router = r
  }

  static async create(
    platformService: PlatformService
  ): Promise<GithubWebhookApp> {
    const probot = createProbot({
      env: {
        APP_ID: process.env.APP_ID,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        WEBHOOK_SECRET: process.env.WEBHOOK_SECRET
      }
    })

    const applicationFunction = async (app: Probot) => {
      logAppStarted()

      // Listen for PR opens to add bot as reviewer
      app.on(
        ['pull_request.opened', 'pull_request.reopened'],
        async (context: Context<WebhookEvents>) => {
          logInfo('Received pull_request.opened or pull_request.reopened event')

          const githubStore = new GithubStore(context)
          await platformService.onPullRequestOpened(githubStore)
        }
      )

      // Listen for review requests to perform on-demand analysis
      app.on(['pull_request.review_requested'], async (context) => {
        logInfo('Received pull_request.review_requested event')
        const githubStore = new GithubStore(context)
        const prNumber = context.payload.pull_request.number
        const repo = context.repo()
        const repository = `${repo.owner}/${repo.repo}`

        await platformService.onReviewRequested(
          githubStore,
          prNumber,
          repository
        )
      })

      // Listen for PR ready for review to automatically perform analysis
      app.on(['pull_request.ready_for_review'], async (context) => {
        logInfo('Received pull_request.ready_for_review event')
        const githubStore = new GithubStore(context)
        const prNumber = context.payload.pull_request.number
        const repo = context.repo()
        const repository = `${repo.owner}/${repo.repo}`

        await platformService.onReadyForReview(
          githubStore,
          prNumber,
          repository
        )
      })
    }

    const middleware = await createNodeMiddleware(applicationFunction, {
      probot,
      webhooksPath: '/api/github/webhooks'
    })
    return new GithubWebhookApp(middleware)
  }
}
