import type { Router } from 'express'
import { logReviewerAdded, logSystemError } from '../utils/logger.ts'
import type { PlatformContext } from '../core/models/platform-types.ts'
import { performCompleteReview } from '../core/services/review-service.ts'

export interface WebhookApp {
    readonly router: Router
}


export interface PlatformStore {
    createPlatformContext(): Promise<PlatformContext>
    isPRCreatedByBot(): boolean
    addBotAsReviewer(proxyReviewerUsername: string): Promise<void>
    isReviewRequestedForBot(proxyReviewerUsername: string): boolean
    isPRDraft(): boolean

    getRepositoryAndBranch(): {
        repositoryUrl: string
        branch: string
    }
}


export class PlatformService {
    private proxyReviewerUsername: string | undefined

    constructor(
        proxyReviewerUsername?: string
    ) {
        this.proxyReviewerUsername = proxyReviewerUsername
    }

    async pullRequestOpened(platformStore: PlatformStore) {
        // Check if PR is created by a bot
        if (platformStore.isPRCreatedByBot()) {
            // Skip bot-created PRs silently
            return
        }

        if (!this.proxyReviewerUsername) {
            logSystemError(
                new Error(
                    'PROXY_REVIEWER_USERNAME not configured, skipping reviewer assignment'
                )
            )
          return
        }

        await platformStore.addBotAsReviewer(this.proxyReviewerUsername)
    }

    async reviewRequested(platformStore: PlatformStore, prNumber: number, repository: string): Promise<void> {
        if (!this.proxyReviewerUsername) {
          logSystemError(
            new Error(
              'PROXY_REVIEWER_USERNAME not configured, aborting review request'
            )
          )
          return
        }

        // Check if the review request is for our proxy user
        if (!platformStore.isReviewRequestedForBot(this.proxyReviewerUsername)) {
          // Skip reviews requested for other users silently
          return
        }

        // Check if PR is in draft status
        if (platformStore.isPRDraft()) {
          // Skip draft PRs silently - will review when ready
          return
        }

        await this.handlePRReview(platformStore, prNumber, repository, 'on-demand')
    }

    async readyForReview(platformStore: PlatformStore, prNumber: number, repository: string): Promise<void> {
        if (platformStore.isPRCreatedByBot()) {
            // Skip bot-created PRs silently
            return
        }

        await this.handlePRReview(platformStore, prNumber, repository, 'automatic')
    }


    /**
     * Handles PR review processing for both on-demand and automatic reviews
     * This function encapsulates the common logic for processing PR reviews
     */
    async handlePRReview(platformStore: PlatformStore, prNumber: number, repository: string, reviewType: 'on-demand' | 'automatic'): Promise<void> {
        let platformContext: PlatformContext
        try {
            platformContext = await platformStore.createPlatformContext()
        } catch (error) {
          logSystemError(error, {
            pr_number: prNumber,
            repository,
            context_msg: 'Failed to create platform context'
          })
          return
        }

        const { repositoryUrl, branch } = platformStore.getRepositoryAndBranch()
        
        try {
            const result = await performCompleteReview(
            repositoryUrl,
            prNumber,
            branch,
            platformContext,
            {
                submitComments: true,
                reviewType,
                repository
            }
            )

            // The review service handles all logging and error posting
            if (!result.success && result.error) {
            logSystemError(result.error, {
                pr_number: prNumber,
                repository: repository,
                context_msg: 'Review service failed to process PR'
            })
            }
        } catch (error) {
            logSystemError(error, {
            pr_number: prNumber,
            repository,
            context_msg: 'Unexpected error in review service'
            })
        }
    }
    
}
