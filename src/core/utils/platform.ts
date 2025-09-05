import type { Router } from 'express'

export interface WebhookApp {
    readonly router: Router
}
