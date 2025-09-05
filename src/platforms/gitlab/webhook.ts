import { Gitlab } from '@gitbeaker/rest'
import Express from 'express'
import type { WebhookApp } from '../index.ts'
import { injectable } from 'tsyringe'
import type { CommentEvent, GitlabEvent, MergeRequestEvent } from './schema.ts'


const ALLOWED_EVENTS = ['Merge Request Hook', 'Note Hook']

@injectable()
export class GitlabWebhookApp implements WebhookApp {
    public readonly router: Express.Router
    private gitlab: InstanceType<typeof Gitlab>

    constructor() {
        this.gitlab = new Gitlab({
            host: process.env.GITLAB_HOST || 'https://gitlab.com',
            token: process.env.GITLAB_TOKEN
        })

        const r = Express.Router()
        r.use((req, res, next) => {
            Express.json({ type: '*/*' })(req, res, next);
        })

        r.post('/', async (req, res) => {
            if (req.headers['X-Gitlab-Token'] !== process.env.WEBHOOK_SECRET) {
                return res.status(401).end()
            }

            if (req.headers['X-Gitlab-Event'] === undefined || !ALLOWED_EVENTS.includes(req.headers['X-Gitlab-Event'] as string)) {
                return res.status(400).end()
            }

            const body = req.body as GitlabEvent

            try {
                if (req.headers['X-Gitlab-Event'] === 'Merge Request Hook') {
                    const payload = body as MergeRequestEvent
                    if (payload.object_attributes.action === 'open' || payload.object_attributes.action === 'reopen') {
                        await this.mergeRequestOpened(payload)
                    }
                }
                else if (req.headers['X-Gitlab-Event'] === 'Note Hook') {
                    const payload = body as CommentEvent
                    await this.handleCommentEvent(payload)
                }
                res.status(200).end()

            } catch (error) {
                console.error('Error handling webhook:', error)
                res.status(500).end()
            }
        })
    }

    async handleCommentEvent(payload: CommentEvent) {
        if (payload.object_attributes.noteable_type !== 'MergeRequest') {
            return
        }
        if (payload.object_attributes.note.startsWith('/revu')) {
            const command = payload.object_attributes.note.split(' ')[0]
            if (command === 'review') {
                await this.handleReviewRequested(payload)
            }
        }
    }

    async mergeRequestOpened(payload: MergeRequestEvent) {

    }

    async handleReviewRequested(payload: CommentEvent) {

    }

}