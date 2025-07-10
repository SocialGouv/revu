#!/usr/bin/env node

import type { Octokit } from '@octokit/rest'
import axios from 'axios'
import chalk from 'chalk'
import { program } from 'commander'
import * as dotenv from 'dotenv'
import { performCompleteReview } from '../core/services/review-service.ts'
import { createMinimalContext } from '../github/context-builder.ts'
import {
  createGithubAppOctokit,
  generateInstallationToken
} from '../github/utils.ts'
import { createPlatformContextFromGitHub } from '../platforms/github/github-adapter.ts'
import { logSystemError } from '../utils/logger.ts'

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
    logSystemError(error, {
      pr_number: prNumber,
      repository: repo,
      context_msg: 'Failed to fetch PR branch'
    })
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
 * Review a PR by URL using the same logic as the production bot
 * @param prUrl GitHub PR URL
 * @param submit Whether to submit comments to GitHub
 * @param strategy Review strategy to use
 */
async function reviewPr(
  prUrl: string,
  submit: boolean,
  strategy?: string
): Promise<void> {
  console.log(chalk.blue(`🔍 Reviewing PR: ${prUrl}`))
  console.log(chalk.gray('⚡ Parsing PR URL...'))

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
    console.warn(
      chalk.yellow('⚠ Failed to generate installation token:'),
      error
    )
    // Continue without token if generation fails
  }

  try {
    // Parse PR URL
    const { owner, repo, prNumber } = parsePrUrl(prUrl)
    console.log(chalk.gray(`📁 Repository: ${owner}/${repo}, PR: #${prNumber}`))

    // Create Octokit instance with GitHub App authentication
    const octokit = await createGithubAppOctokit(owner, repo)

    // Fetch PR details
    console.log(chalk.gray('⚡ Fetching PR details from GitHub...'))
    const headBranch = await fetchPrBranch(owner, repo, prNumber, octokit)
    console.log(chalk.gray(`🌿 Head branch: ${headBranch}`))

    // Construct repository URL
    const repositoryUrl = `https://github.com/${owner}/${repo}.git`

    // Prepare platform-agnostic context for prompt generation
    let body = null
    let title = ''
    try {
      const prResponse = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      })
      body = prResponse.data.body
      title = prResponse.data.title
    } catch (error) {
      console.warn(
        chalk.yellow(`⚠ Could not fetch PR details: ${error.message}`)
      )
    }

    const githubContext = await createMinimalContext(owner, repo, octokit)
    const platformContext = createPlatformContextFromGitHub(
      githubContext,
      prNumber,
      title,
      body || undefined,
      token
    )

    // Use the same review service as the production bot
    const result = await performCompleteReview(
      repositoryUrl,
      prNumber,
      headBranch,
      platformContext,
      {
        submitComments: submit,
        reviewType: 'on-demand',
        repository: `${owner}/${repo}`,
        strategy
      }
    )

    // Handle results
    if (result.success) {
      if (!submit && result.analysis) {
        // Display analysis when not submitting
        console.log(chalk.green('\n=== 📋 PR Analysis Results ===\n'))
        console.log(result.analysis)
        console.log(chalk.green('\n=== ✅ End of Analysis ===\n'))
      }
      console.log(chalk.green(`✅ ${result.message}`))
    } else {
      // Handle validation failure or other errors
      if (result.validationResult && !result.validationResult.isValid) {
        console.log(chalk.yellow('\n⚠️  PR Validation Failed'))
        result.validationResult.issues.forEach((issue, index) => {
          console.log(chalk.yellow(`${index + 1}. ${issue.reason}`))
          console.log(chalk.gray(`   💡 ${issue.suggestion}`))
        })
      }

      if (result.error) {
        console.error(chalk.red(`❌ ${result.error}`))
        process.exit(1)
      } else {
        console.log(chalk.yellow(`⚠️  ${result.message}`))
      }
    }
  } catch (error) {
    console.error(
      chalk.red(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`
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
      const submit = options.submit
      const strategy = options.strategy

      await reviewPr(prUrl, submit, strategy)
    }
  )

// Parse command-line arguments
program.parse(process.argv)
