#!/usr/bin/env node

import type { Octokit } from '@octokit/rest'
import axios from 'axios'
import chalk from 'chalk'
import { program } from 'commander'
import * as dotenv from 'dotenv'
import { getCommentHandler } from '../comment-handlers/index.ts'
import { createMinimalContext } from '../github/context-builder.ts'
import {
  createGithubAppOctokit,
  generateInstallationToken
} from '../github/utils.ts'
import { sendToAnthropic } from '../send-to-anthropic.ts'

// Load environment variables
dotenv.config()

type BranchName = string

/**
 * Parse a GitHub PR URL and extract owner, repo, and PR number
 * @param url GitHub PR URL in the format https://github.com/{owner}/{repo}/pull/{number}
 * @returns Object containing owner, repo, and PR number
 * @throws Error if URL format is invalid
 */
function parsePrUrl(url: string): {
  owner: string
  repo: string
  prNumber: number
} {
  // Match URLs in the format https://github.com/{owner}/{repo}/pull/{number}
  const regex = /https:\/\/github\.com\/([^\\/]+)\/([^\\/]+)\/pull\/(\d+)/
  const match = url.match(regex)

  if (!match) {
    throw new Error(
      'Invalid GitHub PR URL. Expected format: https://github.com/{owner}/{repo}/pull/{number}'
    )
  }

  const [, owner, repo, prNumberStr] = match
  const prNumber = parseInt(prNumberStr, 10)

  return { owner, repo, prNumber }
}

/**
 * Fetch head branch from GitHub API
 * @param owner Repository owner
 * @param repo Repository name
 * @param prNumber PR number
 * @param octokit Octokit instance
 * @returns PR head branch
 * @throws Error if PR cannot be fetched
 */
async function fetchPrBranch(
  owner: string,
  repo: string,
  prNumber: number,
  octokit: Octokit
): Promise<BranchName> {
  try {
    // Get PR details
    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    })

    const headBranch = prData.head.ref

    if (!headBranch) {
      throw new Error('Could not determine head branch from PR')
    }

    return headBranch
  } catch (error) {
    console.error(`error`, error)
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 404) {
        throw new Error(
          `PR #${prNumber} not found in ${owner}/${repo}. Make sure the PR exists and you have access to it.`
        )
      } else if (
        error.response.status === 401 ||
        error.response.status === 403
      ) {
        throw new Error(
          `Authentication error. Please check your GitHub App credentials.`
        )
      } else {
        throw new Error(
          `GitHub API error: ${error.response.status} ${error.response.statusText}`
        )
      }
    }
    throw error
  }
}

/**
 * Review a PR by URL
 * @param prUrl GitHub PR URL
 * @param token GitHub access token
 */
async function reviewPr(
  prUrl: string,
  strategyName: string,
  submit: boolean
): Promise<void> {
  console.log(chalk.blue(`Reviewing PR: ${prUrl}`))
  console.log(chalk.gray('Parsing PR URL...'))
  console.log(chalk.gray(`Strategy: ${strategyName}`))

  // Generate an installation token for private repositories if GitHub App credentials are available
  let token: string | undefined

  try {
    // Extract owner and repo from prUrl
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/.]+)/)
    if (match) {
      const [, owner, repo] = match
      token = await generateInstallationToken(owner, repo)
    }
  } catch (error) {
    console.warn('Failed to generate installation token:', error)
    // Continue without token if generation fails
  }

  try {
    // Parse PR URL
    const { owner, repo, prNumber } = parsePrUrl(prUrl)
    console.log(chalk.gray(`Repository: ${owner}/${repo}, PR: #${prNumber}`))

    // Create Octokit instance with GitHub App authentication
    const octokit = await createGithubAppOctokit(owner, repo)

    // Fetch PR details
    console.log(chalk.gray('Fetching PR details from GitHub...'))
    const headBranch = await fetchPrBranch(owner, repo, prNumber, octokit)
    console.log(chalk.gray(`Head branch: ${headBranch}`))

    // Construct repository URL
    const repositoryUrl = `https://github.com/${owner}/${repo}.git`

    // Start timer for analysis
    const startTime = Date.now()

    // Call sendToAnthropic
    console.log(chalk.yellow('Analyzing PR with Claude...'))

    // Prepare context for prompt generation (includes PR body for issue extraction)
    let body = null
    try {
      const prResponse = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      })
      body = prResponse.data.body
    } catch (error) {
      console.warn(chalk.yellow(`Could not fetch PR body: ${error.message}`))
    }

    const promptContext = {
      prBody: body || undefined,
      repoOwner: owner,
      repoName: repo
    }

    const analysis = await sendToAnthropic({
      repositoryUrl: repositoryUrl,
      branch: headBranch,
      token: token,
      strategyName: strategyName,
      context: promptContext
    })

    // Calculate elapsed time
    const elapsedTime = (Date.now() - startTime) / 1000

    // Output analysis
    console.log(chalk.green('\n=== PR Analysis Results ===\n'))
    console.log(analysis)
    console.log(chalk.green('\n=== End of Analysis ===\n'))
    console.log(
      chalk.gray(`Analysis completed in ${elapsedTime.toFixed(2)} seconds`)
    )

    // If submit is true, call the comment handler
    if (submit) {
      console.log(chalk.yellow('Submitting comments to GitHub...'))

      // Get the appropriate comment handler based on the strategy
      const commentHandler = getCommentHandler(strategyName)

      try {
        // Create a minimal context object for the comment handler
        const context = await createMinimalContext(owner, repo, octokit)

        // Handle the analysis with the appropriate handler
        const result = await commentHandler(context, prNumber, analysis)
        console.log(chalk.green(result || 'Comments submitted successfully'))
      } catch (error) {
        console.error(
          chalk.red(
            `Error submitting comments: ${error instanceof Error ? error.message : String(error)}`
          )
        )
        process.exit(1)
      }
    }
  } catch (error) {
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    )
    process.exit(1)
  }
}

// Set up command-line interface
program
  .name('review-pr')
  .description('Review a GitHub PR by URL using Claude AI')
  .version('1.0.0')
  .argument('<pr-url>', 'GitHub PR URL to review')
  .option(
    '-s, --strategy <strategy>',
    'Review strategy to use',
    'line-comments'
  )
  .option('--submit', 'Submit comments to GitHub after analysis', false)
  .action(
    async (prUrl: string, options: { strategy: string; submit: boolean }) => {
      const strategyName = options.strategy
      const submit = options.submit

      await reviewPr(prUrl, strategyName, submit)
    }
  )

// Parse command-line arguments
program.parse(process.argv)
